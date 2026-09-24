import { describe, expect, it } from 'vitest';

import {
  applyGaugeDelta,
  applyGaugeSetDelta,
  clampGauge,
  isGaugeAtCeiling,
  isGaugeAtFloor,
  isGaugeInRange,
} from './gauges.js';
import type { GaugeSet } from './types/gauges.js';

const FULL: GaugeSet = { vigueur: 5, ame: 5, vivres: 5 };

describe('clampGauge', () => {
  it('holds a gauge between 0 and 5', () => {
    expect(clampGauge(-2)).toBe(0);
    expect(clampGauge(7)).toBe(5);
    expect(clampGauge(3)).toBe(3);
  });

  it('leaves both ends exactly where they are', () => {
    expect(clampGauge(0)).toBe(0);
    expect(clampGauge(5)).toBe(5);
  });
});

describe('applyGaugeDelta', () => {
  it('reports what actually landed, not what was asked for', () => {
    // -3 on a gauge at 1 costs 1, and the journal must say 1.
    expect(applyGaugeDelta(1, -3)).toEqual({ value: 0, applied: -1, clamped: true });
    expect(applyGaugeDelta(4, 3)).toEqual({ value: 5, applied: 1, clamped: true });
  });

  it('says nothing was clamped when nothing was', () => {
    expect(applyGaugeDelta(3, -2)).toEqual({ value: 1, applied: -2, clamped: false });
    expect(applyGaugeDelta(3, 2)).toEqual({ value: 5, applied: 2, clamped: false });
    expect(applyGaugeDelta(3, 0)).toEqual({ value: 3, applied: 0, clamped: false });
  });

  it('measures the loss from inside the range, not from a value no gauge holds', () => {
    // Starting from 9 (which a gauge cannot hold) the change is measured
    // against 5, so the loss is 1 and not 5.
    expect(applyGaugeDelta(9, -1)).toEqual({ value: 4, applied: -1, clamped: false });
    expect(applyGaugeDelta(-4, 1)).toEqual({ value: 1, applied: 1, clamped: false });
  });
});

describe('applyGaugeSetDelta', () => {
  it('moves one gauge and leaves the others alone', () => {
    expect(applyGaugeSetDelta(FULL, 'vigueur', -2)).toEqual({ vigueur: 3, ame: 5, vivres: 5 });
  });

  it('returns a new object rather than the one it was handed', () => {
    // `reduce()` must never mutate the state it is given (invariant 4).
    const next = applyGaugeSetDelta(FULL, 'ame', -1);
    expect(next).not.toBe(FULL);
    expect(FULL.ame).toBe(5);
  });

  it('bounds the gauge it moves', () => {
    expect(applyGaugeSetDelta(FULL, 'vivres', -9).vivres).toBe(0);
    expect(applyGaugeSetDelta(FULL, 'vivres', 9).vivres).toBe(5);
  });
});

describe('the thresholds', () => {
  it('names the floor, where the glossary says it hurts', () => {
    expect(isGaugeAtFloor(0)).toBe(true);
    expect(isGaugeAtFloor(1)).toBe(false);
    expect(isGaugeAtFloor(-3)).toBe(true);
  });

  it('names the ceiling', () => {
    expect(isGaugeAtCeiling(5)).toBe(true);
    expect(isGaugeAtCeiling(4)).toBe(false);
    expect(isGaugeAtCeiling(9)).toBe(true);
  });

  it('knows which values a gauge could have held', () => {
    expect(isGaugeInRange(0)).toBe(true);
    expect(isGaugeInRange(5)).toBe(true);
    expect(isGaugeInRange(6)).toBe(false);
    expect(isGaugeInRange(-1)).toBe(false);
    expect(isGaugeInRange(2.5)).toBe(false);
  });
});
