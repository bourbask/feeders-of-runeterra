/**
 * `src/ai/**` — everything in the storyteller layer that touches persistence,
 * locks or broadcast (01-architecture.md section 2.8).
 *
 * `@for/ai` holds the prompts, the port, the assertions and the pure outputs;
 * it knows neither SQLite nor Fastify, which is what makes the eval harness
 * runnable with no database. This directory is the other half.
 *
 * NO PROVIDER SDK CROSSES THIS DIRECTORY, and the repository is public. The
 * server knows `NarratorPort` and nothing else — held by
 * `tests/ai/lockout.test.ts`, describe « le serveur ne connaît aucun SDK de
 * fournisseur » : its two titles replay the grep of the acceptance criterion on
 * every run and require zero. The SDK's package name is NOT written here — the
 * grep counts lines, and a comment that quoted it would turn the criterion red
 * while proving nothing. It is written out once, in that test file.
 *
 * THE FILE NAME ABOVE WAS WRONG UNTIL M0-30: this header named
 * `tests/ai/no-sdk.test.ts`, which does not exist and never did. The test did,
 * under another name — so the promise was kept, and the pointer was not. Found
 * by the sweep of M0-30's first acceptance criterion, « aucune promesse
 * orpheline », which is exactly the defect it looks for.
 *
 * `narrator.ts` is NOT re-exported here: it belongs to M0-24 and is the one
 * place that reads the port's configuration. Importing it through a barrel
 * would make that single reading point look like a module boundary it is not.
 */

export * from './broadcast.js';
export * from './calls.js';
export * from './chronicle-worker.js';
export * from './context.js';
export * from './forge-worker.js';
export * from './lockout.js';
export * from './proposal-surface.js';
export * from './proposals.js';
export * from './refusal.js';
export * from './scene-state.js';
export * from './turn.js';
