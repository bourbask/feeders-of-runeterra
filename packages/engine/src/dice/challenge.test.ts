import { scriptedRng } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import { ACTION_SCORE_CAP } from '../types/moves.js';
import type { ChallengeInput } from './challenge.js';
import { ChallengeInputImpossible, outcomeFor, rollChallenge } from './challenge.js';

/** A roll with everything neutral, so each test states only what it is about. */
function input(overrides: Partial<ChallengeInput> = {}): ChallengeInput {
  return { attribute: 2, bonus: 0, momentum: 2, burnMomentum: false, ...overrides };
}

describe('outcomeFor', () => {
  it('beats both dice: franche', () => {
    expect(outcomeFor(7, [6, 3])).toBe('franche');
  });

  it('beats one die: partielle', () => {
    expect(outcomeFor(7, [6, 9])).toBe('partielle');
  });

  it('beats neither: echec', () => {
    expect(outcomeFor(7, [8, 9])).toBe('echec');
  });

  it('gives a tie to the challenge die, on either side', () => {
    // The single most consequential line of the rules: `>` and not `>=`.
    expect(outcomeFor(7, [7, 3])).toBe('partielle');
    expect(outcomeFor(7, [3, 7])).toBe('partielle');
    expect(outcomeFor(7, [7, 7])).toBe('echec');
  });
});

describe('rollChallenge', () => {
  it('draws the action die first, then the two challenge dice', () => {
    const rng = scriptedRng([4, 2, 9]);
    const roll = rollChallenge(input(), rng);

    expect(roll.actionDie).toBe(4);
    expect(roll.challengeDice).toEqual([2, 9]);
    expect(rng.trace()).toEqual([
      { sides: 6, value: 4 },
      { sides: 10, value: 2 },
      { sides: 10, value: 9 },
    ]);
    expect(rng.remaining()).toBe(0);
  });

  it('adds attribute and bonus to the action die', () => {
    const roll = rollChallenge(input({ attribute: 3, bonus: 2 }), scriptedRng([4, 1, 1]));
    expect(roll.rawScore).toBe(9);
    expect(roll.score).toBe(9);
  });

  it('accepts a negative bonus, and does not floor the score', () => {
    const roll = rollChallenge(input({ attribute: 1, bonus: -6 }), scriptedRng([1, 5, 5]));
    // 1 + 1 - 6 = -4. `min(rawScore, 10)` is what the specification says, and it
    // says nothing about a floor: an invented floor at zero would change every
    // outcome of a heavily penalised roll.
    expect(roll.rawScore).toBe(-4);
    expect(roll.score).toBe(-4);
    expect(roll.outcome).toBe('echec');
  });

  it('caps the score at ten and keeps the raw total', () => {
    const roll = rollChallenge(input({ attribute: 3, bonus: 6 }), scriptedRng([6, 1, 1]));
    expect(roll.rawScore).toBe(15);
    expect(roll.score).toBe(ACTION_SCORE_CAP);
  });

  it('does not cap a score that lands exactly on ten', () => {
    const roll = rollChallenge(input({ attribute: 3, bonus: 3 }), scriptedRng([4, 1, 1]));
    expect(roll.rawScore).toBe(10);
    expect(roll.score).toBe(10);
  });

  it('cancels the action die when negative momentum equals it', () => {
    const roll = rollChallenge(input({ momentum: -3, attribute: 2 }), scriptedRng([3, 1, 1]));
    expect(roll.momentumCancelled).toBe(true);
    expect(roll.rawScore).toBe(2);
  });

  it('leaves the die alone when negative momentum misses it by one', () => {
    const roll = rollChallenge(input({ momentum: -3 }), scriptedRng([4, 1, 1]));
    expect(roll.momentumCancelled).toBe(false);
    expect(roll.rawScore).toBe(6);
  });

  it('never cancels on positive momentum, even at the same value', () => {
    const roll = rollChallenge(input({ momentum: 3 }), scriptedRng([3, 1, 1]));
    expect(roll.momentumCancelled).toBe(false);
  });

  it('cancels but still draws the challenge dice', () => {
    // The cancelled die is counted as zero, NOT re-rolled: a re-roll would eat
    // a draw and shift every later index of the stream.
    const rng = scriptedRng([6, 7, 8]);
    const roll = rollChallenge(input({ momentum: -6 }), rng);
    expect(roll.momentumCancelled).toBe(true);
    expect(roll.challengeDice).toEqual([7, 8]);
    expect(rng.consumed()).toBe(3);
  });

  it('burns momentum when it beats the capped score', () => {
    const roll = rollChallenge(
      input({ attribute: 1, bonus: 0, momentum: 9, burnMomentum: true }),
      scriptedRng([2, 5, 8]),
    );
    expect(roll.rawScore).toBe(3);
    expect(roll.burned).toBe(true);
    expect(roll.score).toBe(9);
    expect(roll.outcome).toBe('franche');
  });

  it('refuses to burn momentum that does not beat the score', () => {
    const roll = rollChallenge(
      input({ attribute: 3, bonus: 2, momentum: 4, burnMomentum: true }),
      scriptedRng([5, 1, 1]),
    );
    expect(roll.rawScore).toBe(10);
    expect(roll.burned).toBe(false);
    expect(roll.score).toBe(10);
  });

  it('refuses to burn negative momentum, even against a worse score', () => {
    const roll = rollChallenge(
      input({ attribute: 1, bonus: -8, momentum: -2, burnMomentum: true }),
      scriptedRng([1, 5, 5]),
    );
    expect(roll.rawScore).toBe(-6);
    expect(roll.burned).toBe(false);
    expect(roll.score).toBe(-6);
  });

  it('leaves the score alone when the burn was not asked for', () => {
    const roll = rollChallenge(input({ attribute: 1, momentum: 10 }), scriptedRng([1, 5, 5]));
    expect(roll.burned).toBe(false);
    expect(roll.score).toBe(2);
  });

  it('still draws three dice when momentum is burned', () => {
    const rng = scriptedRng([1, 4, 6]);
    rollChallenge(input({ momentum: 10, burnMomentum: true }), rng);
    expect(rng.consumed()).toBe(3);
  });

  it('flags a presage on equal challenge dice, whatever the outcome', () => {
    // The acceptance criterion of M0-07, over the three outcomes AND over every
    // face of the die: `presage` is a property of the dice alone.
    for (let face = 1; face <= 10; face += 1) {
      for (const [attribute, bonus] of [
        [1, -1],
        [2, 3],
        [3, 6],
      ] as const) {
        const roll = rollChallenge(input({ attribute, bonus }), scriptedRng([3, face, face]));
        expect(roll.presage).toBe(true);
      }
    }
  });

  it('never calls equal dice a partial success', () => {
    // A score cannot beat one of two equal numbers without beating the other.
    for (let face = 1; face <= 10; face += 1) {
      for (let score = 0; score <= 11; score += 1) {
        expect(outcomeFor(score, [face, face])).not.toBe('partielle');
      }
    }
  });

  it('flags no presage on different dice', () => {
    expect(rollChallenge(input(), scriptedRng([3, 4, 5])).presage).toBe(false);
  });

  it('refuses an attribute outside the sheet', () => {
    for (const attribute of [0, 4, -1]) {
      expect(() => rollChallenge(input({ attribute }), scriptedRng([1, 1, 1]))).toThrow(
        ChallengeInputImpossible,
      );
    }
  });

  it('refuses a non-integer attribute, bonus or momentum', () => {
    expect(() => rollChallenge(input({ attribute: 2.5 }), scriptedRng([1, 1, 1]))).toThrow(
      ChallengeInputImpossible,
    );
    expect(() => rollChallenge(input({ bonus: 0.5 }), scriptedRng([1, 1, 1]))).toThrow(
      ChallengeInputImpossible,
    );
    expect(() => rollChallenge(input({ momentum: Number.NaN }), scriptedRng([1, 1, 1]))).toThrow(
      ChallengeInputImpossible,
    );
  });

  it('refuses the input before spending a single draw', () => {
    // A refusal that had already drawn would leave the stream one index ahead
    // of the journal.
    const rng = scriptedRng([1, 1, 1]);
    expect(() => rollChallenge(input({ attribute: 9 }), rng)).toThrow(ChallengeInputImpossible);
    expect(rng.consumed()).toBe(0);
  });
});
