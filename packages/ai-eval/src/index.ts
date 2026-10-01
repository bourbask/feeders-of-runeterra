/**
 * `@for/ai-eval` — the harness. IT CARRIES NO ASSERTION.
 *
 * The twenty-eight assertions live in `@for/ai`, because they are used twice:
 * as eval graders here, and as the production post-filter before
 * `s2c.narration_done` is emitted (02-mj-ia.md section 8.6). Hosting them here
 * would create the cycle `ai ↔ ai-eval` that `pnpm depcruise` refuses — and
 * the rule is also a `dependency-cruiser` rule by name,
 * `ai-eval-ne-porte-pas-d-assertion`, which forbids `src/assertions` in this
 * package outright.
 *
 * THE TWO COMMANDS ARE NOT EXPORTED HERE. `run-offline.ts` and `record.ts` are
 * entry points with their own `main`, and `record.ts` is the only module of
 * this package that holds a narrator port. Keeping it off the barrel is what
 * stops a consumer of `@for/ai-eval` from dragging a provider into its graph
 * by importing the package name.
 */

export const NOM = '@for/ai-eval' as const;

export * from './cases.js';
export * from './chronicle.js';
export * from './context.js';
export * from './fixtures.js';
export * from './graders/index.js';
export * from './recorded.js';
export * from './report.js';
export * from './request.js';
