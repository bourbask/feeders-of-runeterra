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
 * ── THE SIX SCENARIO FAMILIES (S-01, ADR 0012) ───────────────────────────
 * `period`, `front`, `node`, `figure`, `hook`, `encounter`. NONE of them adds
 * a primitive to the engine: a front becomes a clock, a node a scene, a figure
 * an `npc` entity, a hook a vow plus bonds, an encounter an oracle draw. Where
 * one of them needs a closed list the engine already owns — segment counts,
 * progress ranks, entity dispositions — it takes the MIRROR from
 * `core/enums.js` through an alias in `common.ts`, never a fresh copy.
 *
 * Unlike every family that came before them, the six are STRICT: an unknown
 * field is refused rather than dropped. `region.ts` and its neighbours are
 * loose and SILENTLY DROP the field — measured, and said out loud by
 * `tests/content/scenario.test.ts` « le JSON Schema ne prouve rien en mode par
 * défaut ». Worth knowing before copying one of them as a model.
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
export * from './encounter.js';
export * from './figure.js';
export * from './front.js';
export * from './hook.js';
export * from './manifest.js';
export * from './move.js';
export * from './node.js';
export * from './oracle.js';
export * from './period.js';
export * from './presage-table.js';
export * from './price-table.js';
export * from './region.js';
export * from './settings.js';
export * from './truth.js';
