/**
 * The three gauges, 0 to 5.
 *
 * Two rules, and a third that is deliberately absent:
 *
 * - A delta is BOUNDED. A -3 on a gauge at 1 takes it to 0, and the journal
 *   records that 1 was lost, not 3. That is what `applied` is for: an event
 *   that wrote -3 would make a replay diverge from the state it produced.
 * - A gauge at its FLOOR is the threshold the game cares about — out of
 *   strength, broken, starving (GLOSSAIRE.md). The predicates name it so that
 *   no caller writes `value === 0` and no caller writes `value <= 0`.
 * - What does NOT live here: what happens at zero. The glossary says what it
 *   MEANS, not what the rules DO, and inventing a consequence would put a rule
 *   in the engine that no specification carries. Moves own consequences; this
 *   file owns arithmetic. Reported with the task.
 */

import type { GaugeId, GaugeSet } from './types/gauges.js';
import { GAUGE_MAX, GAUGE_MIN } from './types/gauges.js';

/** `value`, brought back inside `[GAUGE_MIN, GAUGE_MAX]`. */
export function clampGauge(value: number): number {
  if (value < GAUGE_MIN) return GAUGE_MIN;
  if (value > GAUGE_MAX) return GAUGE_MAX;
  return value;
}

export interface GaugeChange {
  readonly value: number;
  /** What actually landed, once the bounds had their say. */
  readonly applied: number;
  /** `true` when the bounds swallowed part of the delta. */
  readonly clamped: boolean;
}

/**
 * Move one gauge by `delta`, bounded.
 *
 * The STARTING value is brought inside the range first. A gauge cannot hold 9,
 * and measuring a -1 against 9 would report a loss of 5 on a value that never
 * existed. Both ends of the subtraction have to sit inside the range for
 * `applied` to mean anything.
 */
export function applyGaugeDelta(value: number, delta: number): GaugeChange {
  const from = clampGauge(value);
  const next = clampGauge(from + delta);
  const applied = next - from;
  return { value: next, applied, clamped: applied !== delta };
}

/**
 * The same move, over a whole gauge set, returning a NEW set.
 *
 * `reduce()` must never mutate the state it is handed (invariant 4), and the
 * cheapest way to keep that true is for the arithmetic never to hand back the
 * object it was given.
 */
export function applyGaugeSetDelta(gauges: GaugeSet, gauge: GaugeId, delta: number): GaugeSet {
  return { ...gauges, [gauge]: applyGaugeDelta(gauges[gauge], delta).value };
}

/** At zero: out of strength, broken, or starving, depending on the gauge. */
export function isGaugeAtFloor(value: number): boolean {
  return clampGauge(value) === GAUGE_MIN;
}

/** At five: nothing more to gain on this gauge. */
export function isGaugeAtCeiling(value: number): boolean {
  return clampGauge(value) === GAUGE_MAX;
}

/** Whether a value could have come from a gauge at all. */
export function isGaugeInRange(value: number): boolean {
  return Number.isInteger(value) && value >= GAUGE_MIN && value <= GAUGE_MAX;
}
