/**
 * `@for/scenario` — the guided build of ADR 0012.
 *
 * The engine asks a closed question, the model picks one identifier, and the
 * scenario assembles itself out of content that already existed. Nothing here
 * invents a piece, a place, a person or a rule.
 */

export * from './build.js';
export * from './candidates.js';
export * from './deciders.js';
export * from './labels.js';
export * from './steps.js';
export * from './types.js';
export * from './validate.js';
