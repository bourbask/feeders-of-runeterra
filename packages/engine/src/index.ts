/**
 * `@for/engine` — the rules of the game. Pure: no I/O, no ambient clock, no
 * ambient randomness. Its `package.json` declares zero dependencies and its
 * `tsconfig` gives it no ambient typing, so `import { readFileSync } from
 * 'node:fs'` is a COMPILATION error here, not a convention.
 *
 * This file is the ONLY public surface of the package.
 */

export * from './ids.js';
export * from './result.js';
// Named rather than `export *`: `drawUniform` is internal, exported from
// `rng.ts` only so its rejection branch can be proven by a test.
export { RNG_STREAMS, createCampaignRng, createSeededRng } from './rng.js';
export type { Rng, RngDraw, RngStream, TracingRng } from './rng.js';

export * from './types/attributes.js';
export * from './types/brief.js';
export * from './types/campaign.js';
export * from './types/character.js';
export * from './types/clock.js';
export * from './types/effects.js';
export * from './types/entity.js';
export * from './types/events.js';
export * from './types/gauges.js';
export * from './types/intents.js';
export * from './types/moves.js';
export * from './types/progress.js';
export * from './types/scene.js';
export * from './types/violations.js';
export * from './types/vow.js';
