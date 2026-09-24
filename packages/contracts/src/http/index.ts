/**
 * The HTTP surface of M0 (01-architecture.md section 6).
 *
 * Every route declares its `params`, `querystring`, `body` and `response` from
 * this folder, through `fastify-type-provider-zod`. A handler that validates
 * by hand is a second contract.
 *
 * This barrel exists so that filling `http/` never touches `src/index.ts`.
 */

export * from './auth.js';
export * from './characters.js';
export * from './content.js';
export * from './health.js';
export * from './tables.js';
