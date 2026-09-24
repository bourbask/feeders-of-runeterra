/**
 * Game-content schemas (03-donnees.md sections 4.2 to 4.7).
 *
 * Game content is JSON reviewed in a PR. These schemas are what stops a
 * badly-written file from starting the server.
 *
 * TWO SCHEMAS ARE ALREADY WRITTEN ELSEWHERE, and this folder imports them
 * rather than redeclaring them:
 *
 *   - `EffectSchema` / `zEngineEffect`, in `src/core/effects.ts`. ADR 0006
 *     assigns it to M0-05. Two declarations would be two answers to "how many
 *     modes does `pay_price` have", which is the exact question ADR 0006
 *     exists to close.
 *   - `AttributeSpreadSchema` / `zAttributeSpread`, in `src/core/attributes.ts`.
 *
 * They are NOT re-exported here: `src/index.ts` star-exports both `core/` and
 * `content/`, and a name exported by two starred modules is silently dropped
 * from the barrel by ES module semantics. Same reasoning for
 * `CampaignSettingsSchema`, which `content/settings.ts` binds to the existing
 * `zCampaignSettings` instead of restating.
 *
 * `content/effect.ts` is absent for the same reason: its content is
 * `src/core/effects.ts`, and an empty file bearing the name would invite
 * somebody to fill it.
 */

export * from './asset.js';
export * from './champion-index.js';
export * from './champion.js';
export * from './common.js';
export * from './condition.js';
export * from './manifest.js';
export * from './move.js';
export * from './oracle.js';
export * from './presage-table.js';
export * from './price-table.js';
export * from './region.js';
export * from './settings.js';
export * from './truth.js';
