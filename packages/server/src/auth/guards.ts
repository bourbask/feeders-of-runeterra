/**
 * Who is asking, what they may do, and the CSRF rule
 * (01-architecture.md section 6).
 *
 * EVERY PROMISE BELOW NAMES THE TEST THAT HOLDS IT (CLAUDE.md, « une promesse
 * nomme le test qui la tient »).
 *
 * THREE DECORATORS AND ONE HOOK, and the split is deliberate:
 *
 *   - `currentPlayer(request)` answers `null` for an anonymous caller. It is
 *     the only one a route may use to DECIDE something quietly;
 *   - `requirePlayer(request)` throws 401. Routes call it in the handler
 *     rather than as a `preHandler`, so the 401 carries the same
 *     `AppErrorPayload` as everything else. Held by
 *     `tests/http/session.test.ts`, « répond 401 sans cookie », which parses
 *     the body with `zAppErrorPayload`;
 *   - `requireAdmin(request, reply)` is Fastify-shaped because `deps.ts`
 *     declared it that way for `/api/admin/health`, which M0-20 wrote to FAIL
 *     CLOSED until this file exists. Held by `tests/http/composition.test.ts`,
 *     « ferme /api/admin/health à tout le monde sauf aux administrateurs »,
 *     on the app the REAL `buildApp` composes, in three directions: nobody,
 *     somebody, an administrator.
 *
 * THE CSRF HOOK IS `onRequest` ON THE ROOT INSTANCE, not a per-route option,
 * and that is the whole defence: a route added later by M0-24 or M0-25 is
 * covered the day it is written, without anybody remembering. A per-route
 * guard protects the routes somebody remembered to guard. Held by two tests of
 * `tests/http/session.test.ts`: « couvre une route qui n'existe pas : le
 * crochet est global, pas par route » for the "root instance" half, and
 * « refuse AVANT de lire le corps : le crochet est onRequest, pas preHandler »
 * for the lifecycle half — a body no parser can accept answers 403, which only
 * a hook running before the content parser can do.
 *
 * NOTHING HERE READS THE DATABASE UNTIL A COOKIE IS PRESENT. `/healthz` is
 * built over a connection that throws on any access and asserts the touch list
 * is EMPTY; a hook that resolved a session on every request would make that
 * test red — which is the test doing its job, and the reason the lookup is
 * lazy here. Held by `tests/http/health.test.ts`, « répond 200 sans jamais
 * toucher la base », whose tripwire is itself shown to bite by « le fil-piège
 * mord bien : /readyz, lui, touche la base ».
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
 * `tests/http/session.test.ts`, « porte sur les quatre verbes mutants, écrits
 * ici en toutes lettres », compares its own literal list to this one, and
 * « refuse les quatre verbes et laisse passer les deux lectures » walks all
 * six verbs against a live application. A test that looped over this constant
 * would go green the day somebody empties it — the sixth failure mode of
 * `docs/RECETTE.md`, and this repository has already paid for it once.
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
  /** `auth_sessions.id`: the SHA-256 of the cookie. See `session.ts`'s header. */
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
 *
 * Held by `tests/http/session.test.ts`, « répond 200 avec le cookie, et rend
 * le profil projeté », which asserts the FIVE raw keys and no sixth — on the
 * raw JSON, because `zMeResponse.parse` would strip a leaked field before the
 * assertion could see it — and which hunts the snowflake through the whole
 * body, allowing it only inside the CDN URL.
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
 *
 * Held by `tests/http/session.test.ts`, « répond 401 à un joueur anonymisé
 * (RGPD), sur une session pourtant vivante », which shows the SAME cookie
 * answering 200 before and 401 after, then reads the row back to show the
 * session was neither revoked nor expired — so the refusal comes from this
 * clause and from nowhere else.
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
 *
 * Held by `tests/http/session.test.ts`, « résout une seule fois par requête,
 * et repousse la date à la requête suivante », measured at TWO INSTANTS: the
 * second call on the same request object writes nothing, a new request object
 * moves `last_used_at` by exactly the sixty seconds elapsed. Without that
 * second half the first would also hold for a `touchSession` gone inert.
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
