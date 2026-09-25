/**
 * Who is asking, what they may do, and the CSRF rule
 * (01-architecture.md section 6).
 *
 * THREE DECORATORS AND ONE HOOK, and the split is deliberate:
 *
 *   - `currentPlayer(request)` answers `null` for an anonymous caller. It is
 *     the only one a route may use to DECIDE something quietly;
 *   - `requirePlayer(request)` throws 401. Routes call it in the handler
 *     rather than as a `preHandler`, so the 401 carries the same
 *     `AppErrorPayload` as everything else;
 *   - `requireAdmin(request, reply)` is Fastify-shaped because `deps.ts`
 *     declared it that way for `/api/admin/health`, which M0-20 wrote to FAIL
 *     CLOSED until this file exists.
 *
 * THE CSRF HOOK IS `onRequest` ON THE ROOT INSTANCE, not a per-route option,
 * and that is the whole defence: a route added later by M0-24 or M0-25 is
 * covered the day it is written, without anybody remembering. A per-route
 * guard protects the routes somebody remembered to guard.
 *
 * NOTHING HERE READS THE DATABASE UNTIL A COOKIE IS PRESENT. `/healthz` is
 * built over a connection that throws on any access and asserts the touch list
 * is EMPTY (`tests/http/health.test.ts`); a hook that resolved a session on
 * every request would make that test red — which is the test doing its job,
 * and the reason the lookup is lazy here.
 */

import { AppError } from '../errors.js';
import { avatarUrl } from './discord.js';
import { SESSION_COOKIE_NAME, findLiveSession, touchSession } from './session.js';

import type { PlayerProfile } from '@for/contracts';
import type { SqliteConnection } from '@for/db';
import type { FastifyRequest } from 'fastify';
import type { AppDeps } from '../deps.js';
import type { DiscordClient } from './discord.js';

/**
 * The methods the CSRF header is demanded on.
 *
 * WRITTEN OUT, NOT DERIVED, and the test that checks it is written out too:
 * `tests/http/csrf.test.ts` lists the four verbs literally and compares its
 * own list to this one. A test that looped over this constant would go green
 * the day somebody empties it — the sixth failure mode of `docs/RECETTE.md`,
 * and this repository has already paid for it once.
 */
export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

export type MutatingMethod = (typeof MUTATING_METHODS)[number];

export function isMutating(method: string): boolean {
  return (MUTATING_METHODS as readonly string[]).includes(method.toUpperCase());
}

/** 403 — the mutation carried no `X-Requested-With: for-app`. */
export function csrfFailed(details?: unknown): AppError {
  return new AppError(
    'csrf_failed',
    403,
    "Cette action n'a pas pu être vérifiée. Recharge la page et réessaie.",
    details,
  );
}

/** 403 — signed in, but not allowed here. */
export function forbidden(message: string, details?: unknown): AppError {
  return new AppError('forbidden_campaign', 403, message, details);
}

/** What a signed-in request carries. `profile` is exactly what `/api/me` returns. */
export interface SignedInPlayer {
  /** `auth_sessions.id`, i.e. the SHA-256 of the cookie. Never the cookie. */
  readonly sessionId: string;
  readonly profile: PlayerProfile;
}

interface PlayerRow {
  readonly id: string;
  readonly discord_user_id: string;
  readonly discord_username: string;
  readonly discord_global_name: string | null;
  readonly discord_avatar_hash: string | null;
  readonly locale: string;
  readonly is_admin: number;
  readonly deleted_at: number | null;
}

/**
 * The `players` row projected down to what a browser may see.
 *
 * A PROJECTION, as `@for/contracts` asks in so many words: the snowflake, the
 * e-mail column and `last_seen_at` stay in the database. `displayName` is
 * resolved here rather than in the client, so one rule decides it.
 */
export function profileOf(row: PlayerRow): PlayerProfile {
  return {
    id: row.id as PlayerProfile['id'],
    displayName: row.discord_global_name ?? row.discord_username,
    avatarUrl: avatarUrl(row.discord_user_id, row.discord_avatar_hash),
    locale: row.locale,
    isAdmin: row.is_admin === 1,
  };
}

/**
 * Resolves the cookie into a player, or `null`.
 *
 * `deleted_at IS NULL` is in the SQL, not in a later `if`: an anonymised
 * player (GDPR — the schema never deletes one) must not sign in again on a
 * session that predates the anonymisation.
 */
export function resolveSession(
  connection: SqliteConnection,
  secret: string,
  now: number,
): SignedInPlayer | null {
  const session = findLiveSession(connection, secret, now);
  if (session === undefined) return null;

  const row = connection
    .prepare(`SELECT * FROM players WHERE id = ? AND deleted_at IS NULL`)
    .get(session.player_id) as PlayerRow | undefined;
  if (row === undefined) return null;

  touchSession(connection, session.id, now);
  return { sessionId: session.id, profile: profileOf(row) };
}

/** The cookie's value on this request, or `null`. */
export function sessionSecretOf(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  return raw === undefined || raw === '' ? null : raw;
}

/**
 * The resolver the plugin decorates the instance with.
 *
 * Memoised PER REQUEST on a symbol rather than re-read: `/api/me` asks once,
 * a guard asks again, and two lookups would also mean two `last_used_at`
 * writes for one HTTP request.
 */
const RESOLVED = Symbol('for.signedInPlayer');

interface Memo {
  [RESOLVED]?: SignedInPlayer | null;
}

export function currentPlayer(deps: AppDeps, request: FastifyRequest): SignedInPlayer | null {
  const memo = request as FastifyRequest & Memo;
  const cached = memo[RESOLVED];
  if (cached !== undefined) return cached;

  const secret = sessionSecretOf(request);
  const resolved =
    secret === null ? null : resolveSession(deps.connection, secret, deps.clock.now());
  memo[RESOLVED] = resolved;
  return resolved;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** `null` when nobody is signed in. Installed by `authPlugin`. */
    currentPlayer: (request: FastifyRequest) => SignedInPlayer | null;
    /** Throws `unauthenticated` (401) when nobody is signed in. */
    requirePlayer: (request: FastifyRequest) => SignedInPlayer;
    /** The Discord client, injectable for tests through the plugin's options. */
    discord: DiscordClient;
  }
}
