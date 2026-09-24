/**
 * `swear-a-vow` — jurer un serment.
 *
 * The move that OPENS a track. The handler does not open it: it says which
 * rank the player asked for and what the vow is called, and the content file
 * declares `{ op: 'track_create', trackKind: 'vow', rankFrom: 'player' }`.
 * The executor in `decide.ts` mints the identifier.
 *
 * Splitting it that way is not ceremony. `rankFrom: 'player' | 'fixed'` exists
 * in `EngineEffect` precisely so a content author can write a move that opens a
 * track of a rank the player does NOT choose; a handler that created the track
 * itself would make that field dead.
 */

import type { Result } from '../result.js';
import { isErr, ok } from '../result.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveHandler, MovePlan, MovePlanInput } from './handler.js';
import { chooseAttribute, planOf } from './handler.js';

type SwearAVowIntent = Extract<MovePlanInput['intent'], { readonly type: 'move.swear_a_vow' }>;

export const swearAVow: MoveHandler<SwearAVowIntent> = {
  id: 'swear-a-vow',
  intentType: 'move.swear_a_vow',
  plan({ definition, intent }): Result<MovePlan, RuleViolation> {
    const attribute = chooseAttribute(definition, undefined);
    if (isErr(attribute)) return attribute;
    return ok({
      ...planOf({ kind: 'action', attribute: attribute.value, bonus: 0 }, intent.text),
      playerRank: intent.rank,
      trackTitle: intent.text,
    });
  },
};
