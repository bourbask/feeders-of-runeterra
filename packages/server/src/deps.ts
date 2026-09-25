/**
 * `AppDeps` — everything `buildApp` is given, and the only way anything
 * non-deterministic enters the server (01-architecture.md section 2.8).
 *
 * The clock, the randomness and the identifier source are INJECTED, for the
 * same reason the engine takes them as parameters: invariant 4 says a campaign
 * replays, and a replay cannot go through `Date.now()`. The server is not
 * lint-forbidden from an ambient clock outside `src/game/**`, so the
 * discipline here is carried by the shape of this record rather than by a
 * rule — which is worth saying out loud, because it means a future module CAN
 * reach for `Date.now()` and nothing will stop it.
 *
 * WHAT IS NOT HERE, AND WHY: the storyteller port. 01-architecture.md section
 * 2.8 lists `ai` among the injected dependencies, but the same section puts
 * the construction of the port in `src/ai/narrator.ts` — "the ONLY place in
 * the server that reads the storyteller's configuration" — and that file is
 * owned by M0-24. `selectNarrator` does not exist yet either: `@for/ai` is
 * being written by M0-18 in THIS wave. Putting a `NarratorPort` field here
 * would therefore force M0-24 to reopen `deps.ts` and `main.ts`, neither of
 * which is in its file list. `env` is in the record instead, and
 * `buildNarrator(deps.env)` is a one-line call from the plugin that needs it.
 * Reported as a deviation from section 2.8 rather than applied in silence.
 */

import { randomBytes } from 'node:crypto';

import { createCampaignRng } from '@for/engine';

import type { ContentRegistry } from '@for/content';
import type { DrizzleDb, SqliteConnection } from '@for/db';
import type { IdFactory, RngStream, TracingRng } from '@for/engine';
// NO `import type { FastifyRequest, FastifyReply } from 'fastify'` HERE, and it
// must not come back. Inside `declare module 'fastify'` below, those two names
// already resolve to the AUGMENTED module's own scope; an import of them at the
// top of this file is therefore unused by construction. It compiled while
// nothing else augmented `fastify` — the moment M0-23 registered
// `@fastify/cookie`, which declares `interface FastifyInstance extends
// SignerMethods`, `tsc -b` started answering TS6192 on this very line and the
// whole package stopped building. Removed by M0-23 and reported. Held by the
// `typecheck` gate itself — putting the import back makes `tsc -b` exit 1 —
// and not by a unit test, which is said here rather than dressed up as one.
import type { Logger } from 'pino';
import type { Env } from './env.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Installed by the auth plugin (M0-23). While it is absent, every route
     * that asks for it answers 401: an admin route that is merely UNGUARDED
     * until somebody remembers to guard it is a public disclosure of the
     * deployment's disk, WAL size and backup age.
     */
    requireAdmin?: (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void;
  }
}

/** Epoch milliseconds, injected. */
export interface TimeSource {
  now(): number;
}

/** One generator per `(seed, seq, stream)`, exactly as 03-donnees.md section 3.6 derives them. */
export interface RngSource {
  forCampaign(seed: string, seq: number, stream: RngStream): TracingRng;
}

export interface AppDeps {
  readonly env: Env;
  readonly logger: Logger;
  readonly connection: SqliteConnection;
  readonly db: DrizzleDb;
  readonly content: ContentRegistry;
  readonly clock: TimeSource;
  readonly rng: RngSource;
  readonly ids: IdFactory;
  /** Epoch milliseconds at which the process came up. `/healthz` reports the delta. */
  readonly startedAt: number;
}

/**
 * What every plugin registered by `buildApp` receives.
 *
 * One shape for the four, so `app.ts` can register them in a loop-free but
 * uniform way and never has to be reopened when a plugin starts needing
 * something new: what a plugin needs, it takes from `deps`.
 */
export interface AppPluginOptions {
  readonly deps: AppDeps;
}

export const systemClock: TimeSource = { now: () => Date.now() };

export const campaignRng: RngSource = { forCampaign: createCampaignRng };

// ------------------------------------------------------------------- ULID

/** Crockford base32, the 32 symbols a ULID is written in. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 48 bits of milliseconds, 10 symbols. */
const TIME_LENGTH = 10;
/** 80 bits of randomness, 16 symbols. */
const RANDOM_LENGTH = 16;

function encodeTime(ms: number): string {
  let rest = Math.floor(ms);
  let out = '';
  for (let i = 0; i < TIME_LENGTH; i += 1) {
    out = CROCKFORD.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/**
 * `& 31` is uniform here and would not be for a non-power-of-two alphabet:
 * 256 divides evenly by 32, so every symbol gets exactly eight byte values.
 */
function encodeRandom(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < RANDOM_LENGTH; i += 1) {
    out += CROCKFORD.charAt((bytes[i] ?? 0) & 31);
  }
  return out;
}

/**
 * The identifier source the whole process mints from.
 *
 * NOT MONOTONIC WITHIN A MILLISECOND, and deliberately so: the order of the
 * journal is `seq`, allocated by the database under the campaign row
 * (03-donnees.md section 3.2), never the lexical order of two identifiers. A
 * monotonic counter here would suggest an ordering the system does not use.
 *
 * `random` is a parameter so `deps.test.ts` can pin the bytes and compare the
 * output to a value written out by hand, rather than to the function's own
 * arithmetic.
 */
export function createUlidFactory(
  clock: TimeSource,
  random: (size: number) => Uint8Array = randomBytes,
): IdFactory {
  return {
    next: () => encodeTime(clock.now()) + encodeRandom(random(RANDOM_LENGTH)),
  };
}
