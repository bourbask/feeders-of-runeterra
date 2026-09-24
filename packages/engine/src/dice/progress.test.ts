import { scriptedRng } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import { ProgressBoxesImpossible, rollProgress } from './progress.js';

describe('rollProgress', () => {
  it('draws exactly two challenge dice, and no action die', () => {
    const rng = scriptedRng([6, 3]);
    const roll = rollProgress(7, rng);

    expect(roll.challengeDice).toEqual([6, 3]);
    expect(rng.trace()).toEqual([
      { sides: 10, value: 6 },
      { sides: 10, value: 3 },
    ]);
    expect(rng.remaining()).toBe(0);
  });

  it('scores on the filled boxes, not on a die', () => {
    expect(rollProgress(8, scriptedRng([7, 2])).outcome).toBe('franche');
    expect(rollProgress(8, scriptedRng([7, 9])).outcome).toBe('partielle');
    expect(rollProgress(8, scriptedRng([9, 9])).outcome).toBe('echec');
  });

  it('gives a tie to the challenge die', () => {
    expect(rollProgress(8, scriptedRng([8, 2])).outcome).toBe('partielle');
  });

  it('can only miss on an empty track', () => {
    for (let face = 1; face <= 10; face += 1) {
      expect(rollProgress(0, scriptedRng([face, face])).outcome).toBe('echec');
    }
  });

  it('flags a presage on equal dice, whatever the number of boxes', () => {
    for (let boxes = 0; boxes <= 10; boxes += 1) {
      expect(rollProgress(boxes, scriptedRng([5, 5])).presage).toBe(true);
      expect(rollProgress(boxes, scriptedRng([5, 6])).presage).toBe(false);
    }
  });

  it('carries the box count back, untouched', () => {
    expect(rollProgress(3, scriptedRng([1, 1])).filledBoxes).toBe(3);
  });

  it('accepts both ends of the track', () => {
    expect(rollProgress(0, scriptedRng([1, 1])).filledBoxes).toBe(0);
    expect(rollProgress(10, scriptedRng([1, 1])).filledBoxes).toBe(10);
  });

  it('refuses a box count no track could hold', () => {
    for (const boxes of [-1, 11, 2.5, Number.NaN]) {
      expect(() => rollProgress(boxes, scriptedRng([1, 1]))).toThrow(ProgressBoxesImpossible);
    }
  });

  it('refuses before spending a draw', () => {
    const rng = scriptedRng([1, 1]);
    expect(() => rollProgress(42, rng)).toThrow(ProgressBoxesImpossible);
    expect(rng.consumed()).toBe(0);
  });
});
