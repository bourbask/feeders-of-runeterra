/**
 * WebSocket protocol schemas — EMPTY ON PURPOSE.
 *
 * M0-08 fills this folder (`envelope.ts`, `c2s.ts`, `s2c.ts`, `codes.ts`) and
 * re-exports them from here. The barrel exists already so that M0-08 never has
 * to touch `src/index.ts`, which M0-09 and M0-12 are editing in parallel.
 *
 * `export {}` rather than nothing: an empty file is not a module, and
 * `isolatedModules` would refuse it.
 */

export {};
