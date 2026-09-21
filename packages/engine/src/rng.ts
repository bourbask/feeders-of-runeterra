/**
 * Reproducible randomness.
 *
 * The engine sees a port, `Rng`, and nothing else. Behind it sits a stateless
 * derivation: (campaign seed, event seq, stream) -> a reproducible series of
 * draws. Replaying the journal from any point gives the same dice, which is
 * invariant 4 (03-donnees.md section 3.6).
 *
 * No dependency, and no `node:crypto`: the hash is written here by hand
 * (cyrb128 for seeding, sfc32 for the stream). SHA-256 is still used for
 * `state_hash` and `content_hash`, but in `@for/db` and `@for/content`, which
 * are allowed to import node builtins.
 */

/**
 * Normalised draw streams. Every draw event persists its stream and its index,
 * so any roll of the campaign can be reproduced bit for bit.
 */
export const RNG_STREAMS = [
  'action',
  'challenge-a',
  'challenge-b',
  'oracle',
  'price',
  'presage',
  'fallback',
] as const;

export type RngStream = (typeof RNG_STREAMS)[number];

export interface Rng {
  /** Uniform integer in [1, sides]. The only random primitive of the engine. */
  roll(sides: number): number;
}

export interface RngDraw {
  readonly sides: number;
  readonly value: number;
}

export interface TracingRng extends Rng {
  trace(): readonly RngDraw[];
}

/** 2^32, the size of the uint32 space the generator draws from. */
const UINT32_SPAN = 0x1_0000_0000;

/**
 * cyrb128: a seed string to four uint32 words.
 *
 * Public-domain construction. `Math.imul` is the 32-bit multiply; what this
 * package forbids is the ambient random source, not the rest of `Math`.
 */
function cyrb128(seed: string): [number, number, number, number] {
  let h1 = 1_779_033_703;
  let h2 = 3_144_134_277;
  let h3 = 1_013_904_242;
  let h4 = 2_773_480_762;

  for (let i = 0; i < seed.length; i += 1) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597_399_067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2_869_860_233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951_274_213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2_716_044_179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597_399_067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2_869_860_233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951_274_213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2_716_044_179);

  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** sfc32: a small chaotic generator. Returns uint32 values. */
function sfc32(seedWords: readonly [number, number, number, number]): () => number {
  let a = seedWords[0] >>> 0;
  let b = seedWords[1] >>> 0;
  let c = seedWords[2] >>> 0;
  let d = seedWords[3] >>> 0;

  return function next(): number {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

/**
 * Rejection sampling: uniform integer in [1, sides] from a uint32 source.
 *
 * A plain `next() % sides` is biased whenever `sides` does not divide 2^32:
 * the first `2^32 mod sides` values would come up once more often than the
 * rest. On a d12 that is a measurable thumb on the scale of "pay the price".
 * We therefore drop every draw that falls in the truncated tail and take
 * another one.
 *
 * Exported for the test that proves the rejection actually happens: with a
 * real generator the tail is hit roughly once in 10^9 draws, so a test that
 * could not inject its own source would leave this branch unproven.
 *
 * @internal not re-exported by `index.ts`.
 */
export function drawUniform(next: () => number, sides: number): number {
  if (!Number.isInteger(sides) || sides < 1) {
    throw new RangeError(`sides must be an integer >= 1, got ${String(sides)}`);
  }
  // Largest multiple of `sides` that fits in the uint32 space.
  const limit = UINT32_SPAN - (UINT32_SPAN % sides);
  let value = next();
  while (value >= limit) {
    value = next();
  }
  return (value % sides) + 1;
}

function tracingRngFrom(next: () => number): TracingRng {
  const draws: RngDraw[] = [];
  return {
    roll(sides: number): number {
      const value = drawUniform(next, sides);
      draws.push({ sides, value });
      return value;
    },
    trace(): readonly RngDraw[] {
      return [...draws];
    },
  };
}

/**
 * Deterministic generator seeded by a string. Two generators built from the
 * same seed yield the same series.
 */
export function createSeededRng(seed: string): TracingRng {
  return tracingRngFrom(sfc32(cyrb128(seed)));
}

/**
 * Stateless derivation: (campaign seed, event seq, stream) -> draws.
 *
 * Stateless is the point. Reproducing draw number seven of stream `price` at
 * seq 412 needs no reconstruction of everything that came before, which is
 * what makes the golden corpus and `pnpm db:rebuild` possible.
 */
export function createCampaignRng(seed: string, seq: number, stream: RngStream): TracingRng {
  if (!Number.isInteger(seq) || seq < 0) {
    throw new RangeError(`seq must be a non-negative integer, got ${String(seq)}`);
  }
  return createSeededRng(`${seed}|${String(seq)}|${stream}`);
}
