/**
 * AI input/output schemas — EMPTY ON PURPOSE.
 *
 * M0-18 and the narrator tasks fill this folder (`narration.ts`, `forge.ts`,
 * `chronicle.ts`, `tools.ts`, 01-architecture.md section 2.4) and re-export it
 * from here, without touching `src/index.ts`.
 *
 * One rule governs everything that lands here: NO schema in this folder ever
 * accepts an `EngineEffect`, a gauge delta, an outcome or an index designating
 * one. A tool that took any of those would put the storyteller back on the
 * decision path (invariant 1).
 */

export {};
