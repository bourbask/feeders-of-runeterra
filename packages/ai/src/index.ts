/**
 * `@for/ai` — the storyteller port, its adapters, the prompts and the frozen
 * tool surface.
 *
 * NO VENDOR NAME CROSSES THIS FILE. The acceptance criterion of M0-18 greps
 * `packages/ai/src` outside `narrator/` for the six provider words and the ten
 * API facts, and expects zero: `selectNarrator` is exported, the four
 * constructors are not, and everything above the port is written against
 * `NarratorPort`, `NarrateFinish` and `NarratorErrorCode`.
 *
 * M0-22 fills the rest — context builder, budget, assertions, outputs,
 * chronicle, forge — and extends this barrel.
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
