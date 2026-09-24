/**
 * `endure-harm` — encaisser.
 *
 * The only move whose FIRST effect is not an outcome: the harm is already
 * taken when the move triggers, so it is imposed before the roll, whatever the
 * roll gives. That is what `upfrontEffects` is for.
 *
 * `amount` is player-supplied, so it is brought back to something a gauge can
 * take: a whole number of points, never negative. A negative "harm" would be a
 * heal, and healing through the harm move is exactly the back door that a
 * clamp at the boundary closes once instead of everywhere downstream.
 */

import type { Result } from '../result.js';
import { isErr, ok } from '../result.js';
import type { EngineEffect } from '../types/effects.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveHandler, MovePlan, MovePlanInput } from './handler.js';
import { chooseAttribute, planOf } from './handler.js';

type EndureHarmIntent = Extract<MovePlanInput['intent'], { readonly type: 'move.endure_harm' }>;

/** Harm taken when the intent names none. */
export const DEFAULT_HARM = 1;

/** The gauge harm lands on. */
export const HARM_GAUGE = 'vigueur';

/** `amount`, as a number of points a gauge can lose. */
export function harmAmount(amount: number | undefined): number {
  if (amount === undefined || !Number.isFinite(amount)) return DEFAULT_HARM;
  const whole = Math.trunc(amount);
  return whole < 0 ? 0 : whole;
}

export const endureHarm: MoveHandler<EndureHarmIntent> = {
  id: 'endure-harm',
  intentType: 'move.endure_harm',
  plan({ definition, intent }): Result<MovePlan, RuleViolation> {
    const attribute = chooseAttribute(definition, undefined);
    if (isErr(attribute)) return attribute;
    const harm: EngineEffect = {
      op: 'gauge',
      gauge: HARM_GAUGE,
      delta: -harmAmount(intent.amount),
      target: 'self',
    };
    return ok({
      ...planOf({ kind: 'action', attribute: attribute.value, bonus: 0 }, ''),
      upfrontEffects: [harm],
    });
  },
};
