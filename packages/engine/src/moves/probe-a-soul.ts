/**
 * `probe-a-soul` — sonder une ame.
 *
 * The target is either a known non-player character or something the player
 * merely describes (`ProbeTarget`). Only the first can be refused: an entity
 * identifier that names nobody is `unknown_entity`, while a description is
 * free text the engine carries and never interprets.
 *
 * Why the description is NOT turned into an entity here: introducing someone
 * is `propose_npc_introduce`, a proposal validated by the server (invariant 1).
 * A move that minted an entity would open a second door onto the structured
 * memory.
 */

import type { Result } from '../result.js';
import { err, isErr, ok } from '../result.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveHandler, MovePlan, MovePlanInput } from './handler.js';
import { bonusOf, chooseAttribute, planOf } from './handler.js';

type ProbeASoulIntent = Extract<MovePlanInput['intent'], { readonly type: 'move.probe_a_soul' }>;

export const probeASoul: MoveHandler<ProbeASoulIntent> = {
  id: 'probe-a-soul',
  intentType: 'move.probe_a_soul',
  plan({ state, definition, intent }): Result<MovePlan, RuleViolation> {
    if (intent.target.kind === 'entity' && state.entities[intent.target.entityId] === undefined) {
      return err({ code: 'unknown_entity', details: { entityId: intent.target.entityId } });
    }
    const attribute = chooseAttribute(definition, undefined);
    if (isErr(attribute)) return attribute;
    const narrativeInput = intent.target.kind === 'description' ? intent.target.text : '';
    return ok(
      planOf(
        { kind: 'action', attribute: attribute.value, bonus: bonusOf(intent) },
        narrativeInput,
      ),
    );
  },
};
