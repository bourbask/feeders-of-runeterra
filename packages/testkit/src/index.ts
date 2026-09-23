/**
 * `@for/testkit` — the deterministic substitutes every test in this repository
 * uses in place of chance, of the clock and of identifier minting, plus the
 * golden corpus runner.
 *
 * This file is the ONLY public surface of the package.
 *
 * The rule these tools serve: a test that reads the wall clock, draws real
 * randomness or mints a ULID cannot be replayed, and a suite that cannot be
 * replayed proves nothing about invariant 4. Everything here fails LOUDLY
 * rather than improvising a value — a test tool that lies is worse than a
 * missing one, because it turns checks that check nothing green.
 */

export { fixedClock } from './clock/fixed.js';
export type { FixedClock } from './clock/fixed.js';

export { counterIds } from './ids/counter.js';
export type { CounterIdFactory } from './ids/counter.js';

export { ScriptedRngExhausted, ScriptedRngOutOfRange, scriptedRng } from './rng/scripted.js';
export type { ScriptedRng } from './rng/scripted.js';

export { RNG_STREAMS, SEEDS, createCampaignRng, createSeededRng } from './rng/seeded.js';
export type { Rng, RngDraw, RngStream, SeedName, TracingRng } from './rng/seeded.js';

export {
  GOLDEN_UPDATE_ENV,
  GoldenMismatch,
  GoldenMissing,
  GoldenUpdateMisused,
  expectGolden,
  goldenUpdateRequested,
} from './golden/runner.js';
export type { GoldenOptions } from './golden/runner.js';

export { GoldenSerialisationError, stableStringify } from './golden/stable-stringify.js';

export * from './fixtures/index.js';
