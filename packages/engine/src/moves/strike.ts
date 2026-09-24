/**
 * `strike` — frapper.
 *
 * The one move that checks the SCENE before it checks the dice, and the
 * reason is 02-mj-ia.md section 4.7: a target that has left is a fact of the
 * structured scene, not a sentence in the prose. Striking someone who is in
 * `absent` is refused here, before a die is drawn — which is also what stops
 * the storyteller's right of refusal from having to undo the turn afterwards
 * (02-mj-ia.md section 4.8: the refusal bears on material possibility).
 *
 * `no_active_scene` and `target_not_present` are two different answers on
 * purpose. "There is no scene" and "he is not in it" are not the same problem
 * and do not have the same fix.
 */

import type { Result } from '../result.js';
import { err, isErr, ok } from '../result.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveHandler, MovePlan, MovePlanInput } from './handler.js';
import { bonusOf, chooseAttribute, planOf } from './handler.js';

type StrikeIntent = Extract<MovePlanInput['intent'], { readonly type: 'move.strike' }>;

export const strike: MoveHandler<StrikeIntent> = {
  id: 'strike',
  intentType: 'move.strike',
  plan({ state, definition, intent }): Result<MovePlan, RuleViolation> {
    const { scene } = state;
    if (scene === null) {
      return err({ code: 'no_active_scene', details: { targetId: intent.targetId } });
    }
    if (!scene.present.some((presence) => presence.ref.id === intent.targetId)) {
      return err({ code: 'target_not_present', details: { targetId: intent.targetId } });
    }
    const attribute = chooseAttribute(definition, intent.attribute);
    if (isErr(attribute)) return attribute;
    return ok(planOf({ kind: 'action', attribute: attribute.value, bonus: bonusOf(intent) }, ''));
  },
};
