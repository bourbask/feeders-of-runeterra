/**
 * `face-danger` — affronter le danger.
 *
 * The plainest move there is, and the reference for every other: the player
 * names an attribute the content offers, the engine rolls, the content says
 * what it costs. The handler adds nothing.
 */

import type { Result } from '../result.js';
import { isErr, ok } from '../result.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveHandler, MovePlan, MovePlanInput } from './handler.js';
import { bonusOf, chooseAttribute, planOf } from './handler.js';

type FaceDangerIntent = Extract<MovePlanInput['intent'], { readonly type: 'move.face_danger' }>;

export const faceDanger: MoveHandler<FaceDangerIntent> = {
  id: 'face-danger',
  intentType: 'move.face_danger',
  plan({ definition, intent }): Result<MovePlan, RuleViolation> {
    const attribute = chooseAttribute(definition, intent.attribute);
    if (isErr(attribute)) return attribute;
    return ok(
      planOf(
        { kind: 'action', attribute: attribute.value, bonus: bonusOf(intent) },
        intent.description,
      ),
    );
  },
};
