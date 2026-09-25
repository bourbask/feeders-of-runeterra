/**
 * `zIntent` — what a client is allowed to ASK for (invariant 3).
 *
 * THERE IS NO `gauge.set`, NO `clock.advance`, NO `price.apply`, NO
 * `narration.*` INTENT, and a proposal for a new intent carrying a RESULT is
 * refused in review (01-architecture.md section 5.3). Read the list below as a
 * list of questions, never of answers: every member says what the player wants
 * to attempt, and not one says what happens.
 *
 * Three shapes are worth naming because they are where a result would sneak
 * in, and where it does not:
 *
 *   - `move.*` carries `description` and at most a `bonus`. No die, no
 *     outcome, no attribute value — the engine reads the attribute from state.
 *   - `momentum.burn` carries a `rollId` and nothing else. The player says
 *     WHICH roll to burn on, never what the revised total should be.
 *   - `oracle.ask` carries a question and a likelihood band. The threshold and
 *     the answer are the engine's.
 *
 * `satisfies z.ZodType<Intent>` mirrors the engine's canonical `Intent`, but it
 * does NOT guard the membership of the union: `ZodType` is covariant in its
 * output, so dropping a variant still typechecks (measured on `zGameEvent`,
 * same construction). The list is held by the runtime comparison in
 * `tests/exhaustive-union.test.ts`, and by nothing else.
 */

import { z } from 'zod';

import type { Intent, ProbeTarget } from '@for/engine';

import { zAttributeSpread } from '../core/attributes.js';
import { zAttributeId, zLikelihood, zProgressRank } from '../core/enums.js';
import { zCharacterId, zEntityId, zRollId, zTrackId } from '../primitives.js';

/** Free French text, carried, never interpreted on this side. */
const zMoveDescription = z.string().min(1).max(2000);

/**
 * A declared bonus. It is NOT a result: the engine decides whether the bonus
 * applies, and refuses the move if it does not.
 */
const zBonus = z.number().int().min(-5).max(5);

export const zProbeTarget = z.union([
  z.object({ kind: z.literal('entity'), entityId: zEntityId }),
  z.object({ kind: z.literal('description'), text: z.string().min(1).max(2000) }),
]) satisfies z.ZodType<ProbeTarget>;

export const zCampaignJoinIntent = z.object({
  type: z.literal('campaign.join'),
  characterId: zCharacterId,
});
export const zCampaignLeaveIntent = z.object({ type: z.literal('campaign.leave') });

/**
 * Triggers the AI forge when the sheet is not handwritten. It goes through the
 * SAME journal as play: `character.created` is what sets the lock.
 */
export const zCharacterCreateDraftIntent = z.object({
  type: z.literal('character.create_draft'),
  championSlug: z.string().min(1),
  spread: zAttributeSpread,
  background: z.string(),
});

export const zMoveFaceDangerIntent = z.object({
  type: z.literal('move.face_danger'),
  attribute: zAttributeId,
  description: zMoveDescription,
  bonus: zBonus.optional(),
});
export const zMoveSecureAdvantageIntent = z.object({
  type: z.literal('move.secure_advantage'),
  attribute: zAttributeId,
  description: zMoveDescription,
  bonus: zBonus.optional(),
});
/** The attribute is forced to `esprit` by the engine, not chosen. */
export const zMoveGatherInformationIntent = z.object({
  type: z.literal('move.gather_information'),
  description: zMoveDescription,
  bonus: zBonus.optional(),
});
export const zMoveProbeASoulIntent = z.object({
  type: z.literal('move.probe_a_soul'),
  target: zProbeTarget,
  bonus: zBonus.optional(),
});
export const zMoveStrikeIntent = z.object({
  type: z.literal('move.strike'),
  targetId: z.string().min(1),
  attribute: z.enum(['fer', 'vif']),
  bonus: zBonus.optional(),
});
export const zMoveEndureHarmIntent = z.object({
  type: z.literal('move.endure_harm'),
  amount: z.number().int().optional(),
});
export const zMoveEndureColdIntent = z.object({ type: z.literal('move.endure_cold') });
export const zMoveSwearAVowIntent = z.object({
  type: z.literal('move.swear_a_vow'),
  text: z.string().min(1),
  rank: zProgressRank,
});
export const zMoveReachAMilestoneIntent = z.object({
  type: z.literal('move.reach_a_milestone'),
  trackId: zTrackId,
});
export const zMoveFulfillYourVowIntent = z.object({
  type: z.literal('move.fulfill_your_vow'),
  trackId: zTrackId,
});
export const zMoveForsakeYourVowIntent = z.object({
  type: z.literal('move.forsake_your_vow'),
  trackId: zTrackId,
  reason: z.string(),
});

/** Burn momentum on a roll whose window is still open. No total, no outcome. */
export const zMomentumBurnIntent = z.object({
  type: z.literal('momentum.burn'),
  rollId: zRollId,
});

/**
 * DECLINE the burn: the dice stand, and the move applies what they gave.
 *
 * Same payload as the burn, and for the same reason — the player says WHICH
 * roll they are answering about, never what the answer does. It carries the
 * `rollId` rather than nothing so that a stale click, on a window already
 * closed, is refused instead of landing on whatever is open now.
 */
export const zMomentumKeepIntent = z.object({
  type: z.literal('momentum.keep'),
  rollId: zRollId,
});

export const zOracleAskIntent = z.object({
  type: z.literal('oracle.ask'),
  question: z.string().min(1),
  likelihood: zLikelihood,
});
export const zOracleDrawIntent = z.object({
  type: z.literal('oracle.draw'),
  oracleId: z.string().min(1),
});

export const zSpeechSayIntent = z.object({
  type: z.literal('speech.say'),
  channel: z.enum(['ic', 'ooc']),
  text: z.string().min(1).max(2000),
});

export const zPlaySessionBeginIntent = z.object({ type: z.literal('play_session.begin') });
export const zPlaySessionEndIntent = z.object({ type: z.literal('play_session.end') });

export const zIntent = z.discriminatedUnion('type', [
  zCampaignJoinIntent,
  zCampaignLeaveIntent,
  zCharacterCreateDraftIntent,
  zMoveFaceDangerIntent,
  zMoveSecureAdvantageIntent,
  zMoveGatherInformationIntent,
  zMoveProbeASoulIntent,
  zMoveStrikeIntent,
  zMoveEndureHarmIntent,
  zMoveEndureColdIntent,
  zMoveSwearAVowIntent,
  zMoveReachAMilestoneIntent,
  zMoveFulfillYourVowIntent,
  zMoveForsakeYourVowIntent,
  zMomentumBurnIntent,
  zMomentumKeepIntent,
  zOracleAskIntent,
  zOracleDrawIntent,
  zSpeechSayIntent,
  zPlaySessionBeginIntent,
  zPlaySessionEndIntent,
]) satisfies z.ZodType<Intent>;

export type IntentDto = z.output<typeof zIntent>;

/** Derived, never hand-written — same reason as `gameEventTypesOfSchema`. */
export function intentTypesOfSchema(): readonly string[] {
  return zIntent.options.map((option) => option.shape.type.value);
}
