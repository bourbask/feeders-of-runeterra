/**
 * The challenge roll: 1d6 + attribute + bonus against 2d10.
 *
 * DRAW ORDER IS PART OF THE RULES. The action die first, then the two challenge
 * dice, left then right. It is fixed here because the journal replays draws by
 * their index on a stream (`roll.action_resolved` carries `rngStream: 'action'`
 * and one `rngDrawIndex`): swapping two draws would rewrite every roll that
 * ever happened.
 *
 * The three faces of the comparison, from GLOSSAIRE.md:
 *
 * | the score beats | outcome     | meaning              |
 * |-----------------|-------------|----------------------|
 * | both dice       | `franche`   | it works             |
 * | one die         | `partielle` | it works, it costs   |
 * | neither         | `echec`     | it does not work     |
 *
 * "Beats" is STRICT. A tie goes to the challenge die, which is why a score of
 * 7 against a 7 and a 3 is a partial success and not a clean one.
 *
 * Equal challenge dice add a presage, whatever the outcome (`presage.ts`). Note
 * what that implies and what the golden corpus pins down: equal dice can never
 * produce `partielle`, because a score cannot beat one of two equal numbers
 * without beating the other.
 */

import { canBurnMomentum, isMomentumNegated } from '../momentum.js';
import type { Rng } from '../rng.js';
import { ATTRIBUTE_MAX, ATTRIBUTE_MIN } from '../types/attributes.js';
import type { Outcome } from '../types/moves.js';
import { ACTION_SCORE_CAP } from '../types/moves.js';
import { isPresage } from './presage.js';

/** Faces of the action die. */
export const ACTION_DIE = 6;

/** Faces of each challenge die. */
export const CHALLENGE_DIE = 10;

export interface ChallengeInput {
  /** The attribute the move keys on, 1..3. */
  readonly attribute: number;
  /** Additional modifiers. May be negative. */
  readonly bonus: number;
  /** The character's momentum, inside its own bounds. */
  readonly momentum: number;
  /** Whether the player is spending momentum on this roll. */
  readonly burnMomentum: boolean;
}

export interface ChallengeRoll {
  /** The raw d6. */
  readonly actionDie: number;
  /** Negative momentum equal to the action die cancelled it. */
  readonly momentumCancelled: boolean;
  /** `actionDie` (0 when cancelled) + attribute + bonus. Unclamped. */
  readonly rawScore: number;
  /** `min(rawScore, ACTION_SCORE_CAP)`, or the momentum when it was burned. */
  readonly score: number;
  readonly burned: boolean;
  readonly challengeDice: readonly [number, number];
  readonly outcome: Outcome;
  readonly presage: boolean;
}

/** Thrown when an input cannot come from a character sheet. */
export class ChallengeInputImpossible extends RangeError {
  constructor(field: string, value: number, expected: string) {
    super(
      `${field} = ${String(value)} cannot come from a character sheet (expected ${expected}). ` +
        `This is a programming error, not a rule violation: rule violations come back as ` +
        `err(RuleViolation) from decide(), never as an exception.`,
    );
    this.name = 'ChallengeInputImpossible';
  }
}

/**
 * How many of the challenge dice the score beats.
 *
 * Shared with the progress roll, which compares the same way against the same
 * two dice — only its score comes from filled boxes instead of a d6.
 */
export function outcomeFor(score: number, challengeDice: readonly [number, number]): Outcome {
  const beaten = (score > challengeDice[0] ? 1 : 0) + (score > challengeDice[1] ? 1 : 0);
  if (beaten === 2) return 'franche';
  if (beaten === 1) return 'partielle';
  return 'echec';
}

function requireInteger(field: string, value: number, expected: string): void {
  if (!Number.isInteger(value)) {
    throw new ChallengeInputImpossible(field, value, expected);
  }
}

/**
 * Roll a challenge.
 *
 * Three draws, always, in this order: d6, d10, d10. The challenge dice are
 * drawn even when momentum is burned — burning replaces the SCORE, it does not
 * cancel the opposition, and a burn that skipped two draws would desynchronise
 * the stream from the journal.
 */
export function rollChallenge(input: ChallengeInput, rng: Rng): ChallengeRoll {
  requireInteger('attribute', input.attribute, `an integer in [1, ${String(ATTRIBUTE_MAX)}]`);
  if (input.attribute < ATTRIBUTE_MIN || input.attribute > ATTRIBUTE_MAX) {
    throw new ChallengeInputImpossible(
      'attribute',
      input.attribute,
      `an integer in [${String(ATTRIBUTE_MIN)}, ${String(ATTRIBUTE_MAX)}]`,
    );
  }
  requireInteger('bonus', input.bonus, 'an integer');
  requireInteger('momentum', input.momentum, 'an integer');

  const actionDie = rng.roll(ACTION_DIE);
  const challengeDice: readonly [number, number] = [
    rng.roll(CHALLENGE_DIE),
    rng.roll(CHALLENGE_DIE),
  ];

  const momentumCancelled = isMomentumNegated(input.momentum, actionDie);
  const rawScore = (momentumCancelled ? 0 : actionDie) + input.attribute + input.bonus;
  const capped = Math.min(rawScore, ACTION_SCORE_CAP);
  const burned = input.burnMomentum && canBurnMomentum(input.momentum, capped);
  const score = burned ? input.momentum : capped;

  return {
    actionDie,
    momentumCancelled,
    rawScore,
    score,
    burned,
    challengeDice,
    outcome: outcomeFor(score, challengeDice),
    presage: isPresage(challengeDice),
  };
}
