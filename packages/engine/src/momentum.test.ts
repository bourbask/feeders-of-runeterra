import { describe, expect, it } from 'vitest';

import {
  applyMomentumDelta,
  burnMomentum,
  canBurnMomentum,
  clampMomentum,
  isMomentumNegated,
  resetMomentum,
} from './momentum.js';
import type { MomentumBounds } from './types/gauges.js';
import { DEFAULT_MOMENTUM_BOUNDS } from './types/gauges.js';

const BOUNDS = DEFAULT_MOMENTUM_BOUNDS;

/** An asset that widened the track. Bounds are state, not a constant. */
const WIDENED: MomentumBounds = { min: -8, max: 12, reset: 3 };

describe('clampMomentum', () => {
  it('holds the default track between -6 and +10', () => {
    expect(clampMomentum(-7, BOUNDS)).toBe(-6);
    expect(clampMomentum(11, BOUNDS)).toBe(10);
    expect(clampMomentum(2, BOUNDS)).toBe(2);
  });

  it('leaves both ends exactly where they are', () => {
    expect(clampMomentum(-6, BOUNDS)).toBe(-6);
    expect(clampMomentum(10, BOUNDS)).toBe(10);
  });

  it('obeys the character bounds, not the default ones', () => {
    expect(clampMomentum(12, WIDENED)).toBe(12);
    expect(clampMomentum(13, WIDENED)).toBe(12);
    expect(clampMomentum(-8, WIDENED)).toBe(-8);
  });
});

describe('applyMomentumDelta', () => {
  it('reports what actually landed, not what was asked for', () => {
    // A +3 on a character already at +10 is a gain of zero, and the journal
    // must say zero: an event that wrote +3 would make the replay diverge.
    expect(applyMomentumDelta(10, 3, BOUNDS)).toEqual({ momentum: 10, applied: 0, clamped: true });
    expect(applyMomentumDelta(9, 3, BOUNDS)).toEqual({ momentum: 10, applied: 1, clamped: true });
    expect(applyMomentumDelta(-5, -3, BOUNDS)).toEqual({
      momentum: -6,
      applied: -1,
      clamped: true,
    });
  });

  it('says nothing was clamped when nothing was', () => {
    expect(applyMomentumDelta(2, 3, BOUNDS)).toEqual({ momentum: 5, applied: 3, clamped: false });
    expect(applyMomentumDelta(2, -3, BOUNDS)).toEqual({
      momentum: -1,
      applied: -3,
      clamped: false,
    });
    expect(applyMomentumDelta(2, 0, BOUNDS)).toEqual({ momentum: 2, applied: 0, clamped: false });
  });

  it('measures the change from inside the bounds', () => {
    // An asset that narrowed the track leaves a character above the new
    // ceiling. The next delta is measured from the ceiling, not from a value
    // the bounds no longer allow.
    expect(applyMomentumDelta(14, -1, BOUNDS)).toEqual({
      momentum: 9,
      applied: -1,
      clamped: false,
    });
  });
});

describe('isMomentumNegated', () => {
  it('cancels only on exact equality with the action die', () => {
    expect(isMomentumNegated(-3, 3)).toBe(true);
    expect(isMomentumNegated(-3, 2)).toBe(false);
    expect(isMomentumNegated(-3, 4)).toBe(false);
  });

  it('cancels at both ends of the negative range', () => {
    expect(isMomentumNegated(-1, 1)).toBe(true);
    expect(isMomentumNegated(-6, 6)).toBe(true);
  });

  it('never cancels on zero or positive momentum', () => {
    expect(isMomentumNegated(0, 1)).toBe(false);
    for (let die = 1; die <= 6; die += 1) {
      expect(isMomentumNegated(die, die)).toBe(false);
    }
  });
});

describe('canBurnMomentum', () => {
  it('needs momentum strictly above the score', () => {
    expect(canBurnMomentum(7, 6)).toBe(true);
    expect(canBurnMomentum(7, 7)).toBe(false);
    expect(canBurnMomentum(7, 8)).toBe(false);
  });

  it('refuses negative and zero momentum, whatever the score', () => {
    // Without this, a character at -1 against a score of -2 would IMPROVE the
    // score and jump to +2: burning would become a way to gain elan.
    expect(canBurnMomentum(-1, -2)).toBe(false);
    expect(canBurnMomentum(0, -5)).toBe(false);
    expect(canBurnMomentum(1, -5)).toBe(true);
  });
});

describe('burnMomentum', () => {
  it('replaces the score and drops momentum to its reset', () => {
    expect(burnMomentum(9, 4, BOUNDS)).toEqual({ burned: true, score: 9, momentum: 2 });
  });

  it('drops to the character reset, not to a hard-coded +2', () => {
    expect(burnMomentum(9, 4, WIDENED)).toEqual({ burned: true, score: 9, momentum: 3 });
  });

  it('changes nothing at all when the burn would change nothing', () => {
    // Not merely "the score stays": momentum is NOT spent. A burn that quietly
    // destroyed elan for no gain is the failure this branch exists to prevent.
    expect(burnMomentum(4, 4, BOUNDS)).toEqual({ burned: false, score: 4, momentum: 4 });
    expect(burnMomentum(4, 9, BOUNDS)).toEqual({ burned: false, score: 9, momentum: 4 });
    expect(burnMomentum(-3, -5, BOUNDS)).toEqual({ burned: false, score: -5, momentum: -3 });
  });
});

describe('resetMomentum', () => {
  it('is the reset of the bounds it was handed', () => {
    expect(resetMomentum(BOUNDS)).toBe(2);
    expect(resetMomentum(WIDENED)).toBe(3);
  });
});
