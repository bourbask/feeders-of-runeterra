/**
 * The progress roll: filled boxes against 2d10.
 *
 * No action die, no attribute, no bonus, and NO momentum — a progress roll is
 * the one roll momentum cannot touch. Burning it here would let a player spend
 * elan to end a vow, which is exactly the move the two-step burn exists to keep
 * out of the journal.
 *
 * Two draws, in order: left challenge die, then right. Same comparison and same
 * presage rule as the action roll, both read from `challenge.ts` and
 * `presage.ts` rather than copied.
 */

import type { Rng } from '../rng.js';
import type { Outcome } from '../types/moves.js';
import { MAX_PROGRESS_BOXES } from '../types/progress.js';
import { CHALLENGE_DIE, outcomeFor } from './challenge.js';
import { isPresage } from './presage.js';

export interface ProgressRoll {
  /** The score: complete boxes, 0..10. */
  readonly filledBoxes: number;
  readonly challengeDice: readonly [number, number];
  readonly outcome: Outcome;
  readonly presage: boolean;
}

/** Thrown when a box count cannot come from a track. */
export class ProgressBoxesImpossible extends RangeError {
  constructor(filledBoxes: number) {
    super(
      `filledBoxes = ${String(filledBoxes)} cannot come from a track (expected an integer in ` +
        `[0, ${String(MAX_PROGRESS_BOXES)}]). Derive it with boxesFilled(ticks) rather than ` +
        `storing it: a box count kept apart from its tick count drifts away from it.`,
    );
    this.name = 'ProgressBoxesImpossible';
  }
}

/**
 * Roll progress against the two challenge dice.
 *
 * @param filledBoxes complete boxes, from `boxesFilled(track.ticks)`.
 */
export function rollProgress(filledBoxes: number, rng: Rng): ProgressRoll {
  if (!Number.isInteger(filledBoxes) || filledBoxes < 0 || filledBoxes > MAX_PROGRESS_BOXES) {
    throw new ProgressBoxesImpossible(filledBoxes);
  }

  const challengeDice: readonly [number, number] = [
    rng.roll(CHALLENGE_DIE),
    rng.roll(CHALLENGE_DIE),
  ];

  return {
    filledBoxes,
    challengeDice,
    outcome: outcomeFor(filledBoxes, challengeDice),
    presage: isPresage(challengeDice),
  };
}
