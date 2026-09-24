/**
 * Game-content schemas — EMPTY ON PURPOSE.
 *
 * M0-09 fills this folder from 03-donnees.md sections 4.2 to 4.7 and
 * re-exports it from here, without touching `src/index.ts`.
 *
 * TWO SCHEMAS IT WILL FIND ALREADY WRITTEN, and must IMPORT rather than
 * redeclare:
 *
 *   - `EffectSchema` / `zEngineEffect`, in `src/core/effects.ts`. ADR 0006
 *     assigns it to M0-05, and `move.resolved` and `zTurnProof` need it here
 *     and now. Two declarations would be two answers to "how many modes does
 *     `pay_price` have", which is the exact question ADR 0006 exists to close.
 *   - `AttributeSpreadSchema` / `zAttributeSpread`, in `src/core/attributes.ts`.
 *     `character.create_draft` carries a spread, and the engine's
 *     `types/attributes.ts` already points at this package for the 3/2/2/1/1
 *     check.
 *
 * Do NOT re-export them from this file: `src/index.ts` star-exports both
 * `core/` and `content/`, and a name exported by two starred modules is
 * silently dropped from the barrel by the ES module semantics. Leave them
 * where they are.
 */

export {};
