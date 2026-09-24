/**
 * `gather-information` — rassembler des informations.
 *
 * THE ATTRIBUTE IS FORCED, and that is the whole handler: `types/intents.ts`
 * says so in as many words — the intent carries no attribute because the
 * engine imposes `esprit`. Letting the player choose would make this move a
 * second `face-danger` with a better name.
 *
 * It is still checked against the content: a bundle whose `gather-information`
 * does not offer `esprit` is a bundle that disagrees with the rules, and the
 * player gets `attribute_not_allowed` rather than a roll on an attribute the
 * move does not have.
 *
 * ADR 0008, decision 2: this is one of the two moves that BUY a discovery.
 * There is no passive perception score, so nothing here is rolled in secret.
 */

import type { Result } from '../result.js';
import { isErr, ok } from '../result.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveHandler, MovePlan, MovePlanInput } from './handler.js';
import { bonusOf, chooseAttribute, planOf } from './handler.js';

type GatherInformationIntent = Extract<
  MovePlanInput['intent'],
  { readonly type: 'move.gather_information' }
>;

/** Imposed by the rules, not chosen by the player. */
export const GATHER_INFORMATION_ATTRIBUTE = 'esprit';

export const gatherInformation: MoveHandler<GatherInformationIntent> = {
  id: 'gather-information',
  intentType: 'move.gather_information',
  plan({ definition, intent }): Result<MovePlan, RuleViolation> {
    const attribute = chooseAttribute(definition, GATHER_INFORMATION_ATTRIBUTE);
    if (isErr(attribute)) return attribute;
    return ok(
      planOf(
        { kind: 'action', attribute: attribute.value, bonus: bonusOf(intent) },
        intent.description,
      ),
    );
  },
};
