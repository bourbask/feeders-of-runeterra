/**
 * `secure-advantage` — assurer un avantage.
 *
 * Same shape as `face-danger`: the player picks the attribute, the content
 * carries the reward. What differs between the two is entirely in the JSON.
 */

import type { Result } from '../result.js';
import { isErr, ok } from '../result.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveHandler, MovePlan, MovePlanInput } from './handler.js';
import { bonusOf, chooseAttribute, planOf } from './handler.js';

type SecureAdvantageIntent = Extract<
  MovePlanInput['intent'],
  { readonly type: 'move.secure_advantage' }
>;

export const secureAdvantage: MoveHandler<SecureAdvantageIntent> = {
  id: 'secure-advantage',
  intentType: 'move.secure_advantage',
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
