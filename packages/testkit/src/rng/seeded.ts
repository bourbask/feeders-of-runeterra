/**
 * Seeded randomness, re-exported, plus the named seeds.
 *
 * The derivation itself belongs to `@for/engine` (`03-donnees.md` section 3.6):
 * it is production code, not a test double. It is re-exported here so that a
 * test has ONE import for everything random, and so the named seeds sit next
 * to it.
 *
 * Named seeds exist because `createSeededRng('abc')` scattered across fifty
 * files is a magic string fifty times over: when a series has to change, the
 * change should have one place.
 */

export { RNG_STREAMS, createCampaignRng, createSeededRng } from '@for/engine';
export type { Rng, RngDraw, RngStream, TracingRng } from '@for/engine';

/**
 * The seeds tests draw from. Use `SEEDS.default` unless the test has a reason
 * to need another series — and when it does, that reason is the name.
 */
export const SEEDS = {
  /** What a test picks when it just needs dice. */
  default: 'freljord-default',
  /** A second series, for "same input, other seed" comparisons. */
  alternate: 'freljord-alternate',
  /** Campaign seed of the fixture campaigns (M0-10). */
  campaign: 'freljord-campaign',
  /** Long runs: fuzzing, the ~2000-event campaign of invariant 2. */
  fuzz: 'freljord-fuzz',
} as const satisfies Record<string, string>;

export type SeedName = keyof typeof SEEDS;
