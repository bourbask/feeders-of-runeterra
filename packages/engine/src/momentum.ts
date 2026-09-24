/**
 * Momentum: the elan, from -6 to +10, starting at +2.
 *
 * Four rules, and each one is a separate function because each one is asserted
 * separately by the golden corpus:
 *
 * - CLAMP. Momentum never leaves its bounds. The bounds are per character, not
 *   a constant: a content asset may move them (`CharacterState.momentumBounds`).
 * - NEGATION. Negative momentum is a drag: when the action die shows exactly
 *   `|momentum|`, that die is cancelled — it counts as zero, it is not re-rolled.
 *   The distinction matters, because a re-roll would consume a draw and shift
 *   the whole stream.
 * - BURN. Momentum above the score REPLACES it, and falls back to `reset`.
 * - RESET. Where a burn drops you: `bounds.reset`, +2 by default.
 *
 * Burning is a two-step move at the campaign level (ARCHITECTURE.md section 4.3):
 * the roll is written with `burnWindow: true`, the player sees the dice, and the
 * `momentum.burn` intent produces the revision. The first roll is never
 * rewritten. This file computes the arithmetic of the second step; `decide()`
 * owns the window.
 */

import type { MomentumBounds } from './types/gauges.js';

/**
 * Bounds are a REQUIRED argument everywhere below.
 *
 * `DEFAULT_MOMENTUM_BOUNDS` exists and is right for a character nobody has
 * modified, but a default parameter here would let a call site that forgot the
 * character's own bounds keep working — silently applying -6/+10 to someone an
 * asset had moved. A missing argument is a compilation error instead.
 */

/** `value`, brought back inside `[bounds.min, bounds.max]`. */
export function clampMomentum(value: number, bounds: MomentumBounds): number {
  if (value < bounds.min) return bounds.min;
  if (value > bounds.max) return bounds.max;
  return value;
}

export interface MomentumChange {
  readonly momentum: number;
  /** What actually landed, once the bounds had their say. */
  readonly applied: number;
  /** `true` when the bounds swallowed part of the delta. */
  readonly clamped: boolean;
}

/**
 * Move momentum by `delta`.
 *
 * `applied` is the point of the return shape: a +3 gain on a character already
 * at +10 is a gain of zero, and the journal must say zero, not three.
 */
export function applyMomentumDelta(
  momentum: number,
  delta: number,
  bounds: MomentumBounds,
): MomentumChange {
  // The starting value is brought inside the bounds first: both ends of the
  // subtraction have to sit inside the range for `applied` to mean anything.
  const from = clampMomentum(momentum, bounds);
  const next = clampMomentum(from + delta, bounds);
  const applied = next - from;
  return { momentum: next, applied, clamped: applied !== delta };
}

/**
 * Does negative momentum cancel this action die?
 *
 * Only exact equality counts: at -3, a 3 is cancelled and a 4 is not. And only
 * NEGATIVE momentum drags — at +3 an action die of 3 is an ordinary 3.
 */
export function isMomentumNegated(momentum: number, actionDie: number): boolean {
  return momentum < 0 && -momentum === actionDie;
}

/**
 * May this momentum be burned against this score?
 *
 * Two conditions, and the second one is a reading the specification does not
 * spell out. "S'il depasse ton score, il le remplace" gives `momentum > score`.
 * It says nothing about negative momentum, and taken alone it would let a
 * character at -1 burn against a score of -2: the score would IMPROVE to -1 and
 * momentum would jump to +2. Burning would become a way to gain elan, which is
 * the opposite of what it is. So burning also requires momentum to be positive.
 * Reported with the task rather than hidden here.
 */
export function canBurnMomentum(momentum: number, score: number): boolean {
  return momentum > 0 && momentum > score;
}

export interface MomentumBurn {
  readonly burned: boolean;
  /** The score after the burn: the momentum that replaced it, or the score untouched. */
  readonly score: number;
  /** Momentum after the burn: `bounds.reset`, or untouched. */
  readonly momentum: number;
}

/**
 * Burn momentum against a score.
 *
 * A burn that would change nothing changes nothing at all — momentum is not
 * spent, and `burned` is false. `decide()` refuses that intent up front with
 * `momentum_too_low`; this function stays honest on its own so that a caller
 * which skipped the guard cannot quietly destroy a character's elan.
 */
export function burnMomentum(
  momentum: number,
  score: number,
  bounds: MomentumBounds,
): MomentumBurn {
  if (!canBurnMomentum(momentum, score)) {
    return { burned: false, score, momentum };
  }
  return { burned: true, score: momentum, momentum: resetMomentum(bounds) };
}

/** Where a burn drops momentum. */
export function resetMomentum(bounds: MomentumBounds): number {
  return bounds.reset;
}
