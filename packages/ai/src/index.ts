/**
 * `@for/ai` — the storyteller port, its adapters, the prompts and the frozen
 * tool surface.
 *
 * NO VENDOR NAME CROSSES THIS FILE — held by tests/no-env.test.ts « rien
 * hors de narrator/ ne nomme un fournisseur ni un fait d'API », which greps
 * `packages/ai/src` outside `narrator/` for the six provider words and the
 * ten API facts and expects zero. `selectNarrator` is exported, the four
 * constructors are not, and everything above the port is written against
 * `NarratorPort`, `NarrateFinish` and `NarratorErrorCode`.
 *
 * M0-22 filled the rest — context builder, budget, assertions, outputs,
 * chronicle, forge — and extended this barrel. Without these exports nothing
 * delivered there is importable by M0-27 or M0-29.
 */

export const NOM = '@for/ai' as const;

export { classifyStatus, retryAfterMs, type NarratorFetch } from './narrator/http.js';
export * from './narrator/port.js';
export { selectNarrator, type SelectNarratorDeps } from './narrator/select.js';
export { extractAndValidate, firstBalancedObject } from './narrator/structured.js';

export * from './prompts/chronicle.system.js';
export * from './prompts/conteur.campaign.js';
export * from './prompts/conteur.system.js';
export * from './prompts/estimate.js';
export * from './prompts/forge.system.js';
export * from './prompts/scene.block.js';

export * from './tools/definitions.js';
export * from './tools/handlers.js';

export * from './assertions/index.js';

export * from './context/budget.js';
export * from './context/builder.js';
export * from './context/escape.js';
export * from './context/fact.js';

export * from './narration/postfilter.js';
export * from './narration/run.js';

export * from './outputs/chronicle.js';
export * from './outputs/forge.js';
export * from './outputs/narration.js';
export * from './outputs/refusal.js';
export * from './outputs/scene.js';

export * from './chronicle/build.js';
export * from './chronicle/validate.js';

export * from './forge/build.js';
export * from './forge/validate.js';
