/**
 * AI input/output schemas — the ONE door everything the model produces comes
 * through (01-architecture.md section 2.4).
 *
 * One rule governs everything in this folder: NO SCHEMA HERE EVER ACCEPTS an
 * `EngineEffect`, a gauge delta, an outcome, a die value or an index
 * designating one. A tool or a block that took any of those would put the
 * storyteller back on the decision path, which is invariant 1. Read the
 * `ai/narration.ts` header for the asymmetry that makes it visible.
 *
 * `narrator-port.ts` is the only file in `packages/contracts/src` that may
 * name a vendor, and it names them in exactly one construct — its own
 * `NARRATOR_PROVIDER_IDS`. Everything else is written against the port.
 *
 * Two names this folder deliberately does NOT declare, because
 * `src/index.ts` star-exports `core/`, `content/` and `ai/` side by side and a
 * name exported by two starred modules is dropped from the barrel in silence:
 *
 *   - `zSceneState`, which M0-05 delivered in `core/scene-state.ts`. This
 *     folder imports its bounds and mirrors nothing again.
 *   - `ChampionSchema`, which M0-09 delivered in `content/champion.ts`.
 *     `ForgeOutputSchema` is derived from it, never written beside it.
 */

export * from './chronicle.js';
export * from './forge.js';
export * from './narration.js';
export * from './narrator-port.js';
export * from './scene.js';
export * from './tools.js';
