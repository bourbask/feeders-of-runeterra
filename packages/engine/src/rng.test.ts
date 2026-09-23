import { describe, expect, it } from 'vitest';

import {
  createCampaignRng,
  createSeededRng,
  drawUniform,
  RNG_STREAMS,
  type RngStream,
} from './rng.js';

function series(seed: string, count: number, sides = 6): number[] {
  const rng = createSeededRng(seed);
  return Array.from({ length: count }, () => rng.roll(sides));
}

describe('createSeededRng', () => {
  it('gives the same series of 100 draws twice from the same seed', () => {
    expect(series('freljord', 100)).toEqual(series('freljord', 100));
  });

  it('gives a different series for a different seed', () => {
    expect(series('freljord', 100)).not.toEqual(series('freljord ', 100));
  });

  it('stays inside [1, sides]', () => {
    const rng = createSeededRng('bornes');
    for (let i = 0; i < 500; i += 1) {
      const value = rng.roll(12);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(12);
    }
  });

  it('covers every face of a d6 over 600 draws', () => {
    const rng = createSeededRng('couverture');
    const seen = new Set<number>();
    for (let i = 0; i < 600; i += 1) seen.add(rng.roll(6));
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('traces every draw, with its die size, and hands back a copy', () => {
    const rng = createSeededRng('trace');
    const a = rng.roll(6);
    const b = rng.roll(10);
    expect(rng.trace()).toEqual([
      { sides: 6, value: a },
      { sides: 10, value: b },
    ]);
    const snapshot = rng.trace();
    rng.roll(4);
    expect(snapshot).toHaveLength(2);
  });

  it('always returns 1 on a one-sided die', () => {
    const rng = createSeededRng('d1');
    expect([rng.roll(1), rng.roll(1), rng.roll(1)]).toEqual([1, 1, 1]);
  });
});

describe('createCampaignRng', () => {
  it('is reproducible and stateless: same inputs, same draws, in any order', () => {
    const seed = 'a3f1c0de';
    const direct = createCampaignRng(seed, 412, 'price');
    const first = [direct.roll(12), direct.roll(12), direct.roll(12)];

    // Rebuilt later, after other streams were drawn from in between.
    createCampaignRng(seed, 7, 'action').roll(6);
    createCampaignRng(seed, 999, 'oracle').roll(100);
    const again = createCampaignRng(seed, 412, 'price');

    expect([again.roll(12), again.roll(12), again.roll(12)]).toEqual(first);
  });

  it('separates the streams at equal seed and seq', () => {
    const draw = (stream: RngStream): number[] => {
      const rng = createCampaignRng('graine', 1, stream);
      return [rng.roll(20), rng.roll(20), rng.roll(20), rng.roll(20)];
    };
    const perStream = RNG_STREAMS.map((stream) => JSON.stringify(draw(stream)));
    expect(new Set(perStream).size).toBe(RNG_STREAMS.length);
  });

  it('separates the sequence numbers at equal seed and stream', () => {
    const at = (seq: number): number[] => {
      const rng = createCampaignRng('graine', seq, 'action');
      return [rng.roll(6), rng.roll(6), rng.roll(6), rng.roll(6)];
    };
    expect(at(1)).not.toEqual(at(2));
  });

  it('refuses a sequence number that is not a non-negative integer', () => {
    expect(() => createCampaignRng('graine', -1, 'action')).toThrow(RangeError);
    expect(() => createCampaignRng('graine', 1.5, 'action')).toThrow(RangeError);
  });
});

describe('drawUniform rejects the modulo bias', () => {
  // A plain `next() % sides` would make the first `2^32 mod sides` values come
  // up once more often than the rest. On the d12 of "pay the price" that is a
  // thumb on the scale. With a real generator the truncated tail is hit about
  // once in 10^9 draws, so the branch is proven here with an injected source.
  const UINT32_SPAN = 0x1_0000_0000;

  it('drops a draw that falls in the truncated tail and takes the next one', () => {
    const sides = 12;
    const limit = UINT32_SPAN - (UINT32_SPAN % sides);
    expect(limit).toBeLessThan(UINT32_SPAN);

    const source = [limit, limit + 1, UINT32_SPAN - 1, 24];
    let index = 0;
    const next = (): number => {
      const value = source[index] ?? -1;
      index += 1;
      return value;
    };

    // The three tail values are discarded; only 24 is used: 24 % 12 + 1 = 1.
    expect(drawUniform(next, sides)).toBe(1);
    expect(index).toBe(4);
  });

  it('does not reject anything when sides divides the space', () => {
    let calls = 0;
    const next = (): number => {
      calls += 1;
      return UINT32_SPAN - 1;
    };
    expect(drawUniform(next, 16)).toBe(16);
    expect(calls).toBe(1);
  });

  it('refuses a die that is not an integer of at least one side', () => {
    const next = (): number => 0;
    expect(() => drawUniform(next, 0)).toThrow(RangeError);
    expect(() => drawUniform(next, -3)).toThrow(RangeError);
    expect(() => drawUniform(next, 2.5)).toThrow(RangeError);
  });

  it('stays roughly uniform on a d12 over 120000 draws', () => {
    const rng = createSeededRng('uniformite');
    const counts = new Array<number>(12).fill(0);
    const total = 120_000;
    for (let i = 0; i < total; i += 1) {
      const value = rng.roll(12);
      counts[value - 1] = (counts[value - 1] ?? 0) + 1;
    }
    const expected = total / 12;
    for (const count of counts) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.05);
    }
  });
});
