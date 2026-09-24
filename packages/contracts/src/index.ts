/**
 * `@for/contracts` — the Zod mirror of the engine's types, and the validation
 * boundary of the whole system.
 *
 * This file is the ONLY public surface of the package. The sub-folder barrels
 * exist so that a task can fill `ws/`, `http/`, `content/` or `ai/` without
 * ever touching this file — a merge conflict here would block four tasks at
 * once.
 */

export * from './errors.js';
export * from './primitives.js';
export * from './upcast.js';
export * from './version.js';

export * from './core/index.js';
export * from './dto/index.js';
export * from './events/index.js';
export * from './intents/index.js';

export * from './ai/index.js';
export * from './content/index.js';
export * from './http/index.js';
export * from './ws/index.js';
