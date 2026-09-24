/**
 * `endure-cold` — endurer le froid.
 *
 * The intent carries nothing at all: no attribute, no bonus, no text. Crossing
 * a frozen waste without shelter is not a proposal, it is a situation, and the
 * move keys on the first attribute its content file offers.
 *
 * ARCHITECTURE.md section 4.4, "Transition de scene proposee": the time a
 * journey costs is derived from the move played, HERE, never from a value the
 * storyteller supplies. `propose_scene_transition` carries a place and nothing
 * else for exactly that reason.
 */

import type { Result } from '../result.js';
import { isErr, ok } from '../result.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveHandler, MovePlan, MovePlanInput } from './handler.js';
import { chooseAttribute, planOf } from './handler.js';

type EndureColdIntent = Extract<MovePlanInput['intent'], { readonly type: 'move.endure_cold' }>;

export const endureCold: MoveHandler<EndureColdIntent> = {
  id: 'endure-cold',
  intentType: 'move.endure_cold',
  plan({ definition }): Result<MovePlan, RuleViolation> {
    const attribute = chooseAttribute(definition, undefined);
    if (isErr(attribute)) return attribute;
    return ok(planOf({ kind: 'action', attribute: attribute.value, bonus: 0 }, ''));
  },
};
