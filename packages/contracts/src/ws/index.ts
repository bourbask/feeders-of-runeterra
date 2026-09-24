/**
 * The WebSocket protocol, frozen by M0-08 (01-architecture.md section 5,
 * ADR 0008, ADR 0010 decision 1).
 *
 * Read `envelope.ts` first: it explains the three counters (`seq`,
 * `deliverySeq`, `chunk`) that everything else here depends on not confusing.
 *
 * This barrel exists so that filling `ws/` never touches `src/index.ts`, which
 * M0-09 and M0-12 are editing in parallel.
 */

export * from './c2s.js';
export * from './codes.js';
export * from './envelope.js';
export * from './s2c.js';
