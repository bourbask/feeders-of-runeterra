/**
 * Cookie sessions and the short-lived OAuth state, both in zone A
 * (03-donnees.md section 1.1, ADR 0010 arbitration 6).
 *
 * EVERY PROMISE BELOW NAMES THE TEST THAT HOLDS IT (CLAUDE.md, « une promesse
 * nomme le test qui la tient »).
 *
 * THE ONE PROPERTY THIS FILE EXISTS FOR: a dump of the database hands out no
 * usable session. The cookie carries 32 random bytes; `auth_sessions.id` is
 * their SHA-256, and the secret itself is never written anywhere — not in a
 * column, not in a log (`logger.ts` redacts `cookie` and `set-cookie`), not in
 * an error. Looking a session up therefore means hashing what the browser
 * sent and reading by primary key, which is also why the lookup is a single
 * indexed read rather than a scan.
 *
 * Held by `tests/http/session.test.ts`, « ne contient jamais le secret du
 * cookie, seulement son SHA-256 », which reads EVERY COLUMN OF EVERY ROW of
 * `auth_sessions` after a sign-in, asserts the cookie's secret appears in none
 * of them AND that the digest appears in one — "not found" alone is equally
 * true of a scan that looks nowhere. The SHA-256 is recomputed there with
 * `node:crypto` rather than by calling `hashSecret`, so the two sides of the
 * comparison do not come from the same line of code. The log half is held by
 * « n'apparaît dans aucune ligne de journal, même à trace ».
 *
 * NO SIGNATURE ON THE COOKIE, and that is a decision rather than an omission.
 * A signature protects a value the server has to trust as it comes back; this
 * value is looked up, and a forged one simply misses the index. Held by
 * `tests/http/session.test.ts`, « répond 401 sur un cookie inventé, et la base
 * n'a pas bougé ».
 *
 * What `SESSION_SECRET` is used for here is the pepper of `ipHash` — a
 * diagnostic column that must not turn into a list of the players' home
 * addresses if the file leaks. Held by `tests/http/session.test.ts`, « la
 * colonne ne porte ni l'adresse ni son SHA-256 nu, mais celui de l'adresse
 * poivrée » : the bare digest is refused and the peppered one is demanded, so
 * dropping the pepper turns it red rather than green.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from '@for/contracts';

import type { SqliteConnection } from '@for/db';

/** How long a `state` row stays usable. A round trip through Discord is seconds. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** The two cookies that carry ONE round trip of the OAuth flow. */
export const OAUTH_STATE_COOKIE = 'fr_oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'fr_oauth_verifier';

/** 32 bytes. Below that, a session secret is worth guessing. */
export const SECRET_BYTES = 32;

export { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS };

/**
 * base64url of `SECRET_BYTES` bytes, from `node:crypto` by default.
 *
 * Says what the code does: the default argument is `randomBytes`, and the
 * parameter exists so a test can pin the bytes. That the CALLERS never hand it
 * `deps.rng` is not something a test holds — it is read off the three call
 * sites in this package.
 */
export function newSecret(random: (size: number) => Buffer = randomBytes): string {
  return random(SECRET_BYTES).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** What lands in `auth_sessions.id` and in `oauth_states` comparisons. */
export function hashSecret(secret: string): string {
  return sha256(secret);
}

/** PKCE S256: base64url(sha256(verifier)), over the ASCII of the verifier. */
export function codeChallengeOf(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

/**
 * Constant-time comparison of two cookie-borne values.
 *
 * The values compared here are not secrets an attacker submits blind — they
 * are their own cookies — so the timing channel is thin. It costs three lines
 * to close it anyway, and the alternative is a `===` that a later reader has
 * to think about.
 */
export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** `sha256(ip + pepper)`, diagnostics only. The pepper is `SESSION_SECRET`. */
export function hashIp(ip: string, pepper: string): string {
  return sha256(`${ip}${pepper}`);
}

// ────────────────────────────────────────────────────────── oauth_states

export interface OAuthStateRow {
  readonly state: string;
  readonly code_verifier: string;
  readonly redirect_to: string | null;
  readonly created_at: number;
  readonly expires_at: number;
}

export function insertOAuthState(
  connection: SqliteConnection,
  row: { state: string; codeVerifier: string; redirectTo: string | null; now: number },
): void {
  connection
    .prepare(
      `INSERT INTO oauth_states (state, code_verifier, redirect_to, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(row.state, row.codeVerifier, row.redirectTo, row.now, row.now + OAUTH_STATE_TTL_MS);
}

/**
 * Reads the row AND deletes it, whatever happens next.
 *
 * SINGLE USE IS THE POINT: a `state` that survived its callback could be
 * replayed with a second authorisation code. Held by `tests/http/oauth.test.ts`,
 * « le même state, une seconde fois : 400 », which also pins the exchange to
 * ONE call, so a second round trip cannot quietly go through.
 *
 * The delete runs even when the row has expired, so a stale row cannot be
 * retried until the purge catches it — held by « state expiré : 400, aucun
 * joueur, et la ligne est consommée quand même ».
 *
 * `RETURNING` makes read-and-delete one statement. That it is therefore atomic
 * against a second callback arriving at the same instant is a property of
 * SQLite, not of this repository: no test here holds it, and the sentence says
 * what the statement IS rather than what it would survive.
 */
export function consumeOAuthState(
  connection: SqliteConnection,
  state: string,
): OAuthStateRow | undefined {
  return connection.prepare(`DELETE FROM oauth_states WHERE state = ? RETURNING *`).get(state) as
    OAuthStateRow | undefined;
}

/** Drops every row whose deadline has passed. Returns how many. */
export function purgeExpiredOAuthStates(connection: SqliteConnection, now: number): number {
  return connection.prepare(`DELETE FROM oauth_states WHERE expires_at <= ?`).run(now).changes;
}

// ───────────────────────────────────────────────────────── auth_sessions

export interface SessionRow {
  readonly id: string;
  readonly player_id: string;
  readonly created_at: number;
  readonly last_used_at: number;
  readonly expires_at: number;
  readonly revoked_at: number | null;
  readonly user_agent: string | null;
  readonly ip_hash: string | null;
}

export interface NewSessionInput {
  readonly playerId: string;
  readonly now: number;
  readonly userAgent?: string | null;
  readonly ipHash?: string | null;
  /** Injected so a test can pin the bytes; `randomBytes` in production. */
  readonly random?: (size: number) => Buffer;
}

export interface NewSession {
  /** Goes in the cookie, and nowhere else: see this file's header, first promise. */
  readonly secret: string;
  /** `sha256(secret)`. This is what the row is keyed on. */
  readonly id: string;
  readonly expiresAt: number;
}

export function createSession(connection: SqliteConnection, input: NewSessionInput): NewSession {
  const secret = newSecret(input.random ?? randomBytes);
  const id = hashSecret(secret);
  const expiresAt = input.now + SESSION_MAX_AGE_MS;

  connection
    .prepare(
      `INSERT INTO auth_sessions
         (id, player_id, created_at, last_used_at, expires_at, user_agent, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.playerId,
      input.now,
      input.now,
      expiresAt,
      input.userAgent ?? null,
      input.ipHash ?? null,
    );

  return { secret, id, expiresAt };
}

/**
 * The live session behind a cookie, or `undefined`.
 *
 * Revocation and expiry are checked IN SQL rather than after the read: a row
 * that must not authenticate anybody should never become a JavaScript object
 * in the first place, because that object is what a later edit forgets to
 * check.
 *
 * Both clauses are held, each by its own test of `tests/http/session.test.ts`:
 * expiry by « répond 401 quand la session a dépassé ses trente jours », one
 * millisecond past the deadline, and revocation by « révoque la session, et
 * efface le cookie : la requête suivante répond 401 ».
 */
export function findLiveSession(
  connection: SqliteConnection,
  secret: string,
  now: number,
): SessionRow | undefined {
  return connection
    .prepare(
      `SELECT * FROM auth_sessions
        WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .get(hashSecret(secret), now) as SessionRow | undefined;
}

export function touchSession(connection: SqliteConnection, sessionId: string, now: number): void {
  connection.prepare(`UPDATE auth_sessions SET last_used_at = ? WHERE id = ?`).run(now, sessionId);
}

/** Revokes one session by its hashed identifier. Returns how many rows moved. */
export function revokeSession(
  connection: SqliteConnection,
  sessionId: string,
  now: number,
): number {
  return connection
    .prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .run(now, sessionId).changes;
}

/** Revokes the session a cookie names, without ever storing that cookie. */
export function revokeSessionBySecret(
  connection: SqliteConnection,
  secret: string,
  now: number,
): number {
  return revokeSession(connection, hashSecret(secret), now);
}

// ───────────────────────────────────────────────────────── cookie attributes

/**
 * The four attributes section 6 fixes, plus `Path`.
 *
 * ALL FIVE ARE ASSERTED, AND AS WHOLE ATTRIBUTES. `tests/http/session.test.ts`,
 * « le cookie porte HttpOnly, Secure, SameSite=Lax, Path=/ et trente jours »,
 * splits the `Set-Cookie` line and compares each attribute entire: a substring
 * check on the raw line is satisfied by `Path=/api`, which is a different
 * cookie. `Path` earns its own assertion twice over, because
 * `clearedCookieAttributes` below must carry the SAME one — a clear on another
 * path leaves the original cookie sitting beside the empty one, which
 * `expectOauthCookiesCleared` of `tests/http/oauth.test.ts` holds on every
 * exit of the callback.
 *
 * `secure: true` IS UNCONDITIONAL, including in development, and that is a
 * decision worth the two lines it takes to explain. Browsers treat
 * `http://localhost` as a secure context, so a `Secure` cookie is set and sent
 * there exactly as it is over TLS; making the flag depend on `NODE_ENV` would
 * buy nothing and would leave a code path in which the production cookie is
 * the one nobody tested.
 *
 * "Including in development" is held by `tests/http/session.test.ts`, « porte
 * Secure même en développement : l'attribut ne dépend pas de NODE_ENV », which
 * builds the bench on `NODE_ENV=development` and checks `Secure` and
 * `HttpOnly` on ALL THREE cookies of this task — the session one and the two
 * round-trip ones, which no other test looked at.
 *
 * `sameSite: 'lax'` rather than `'strict'`: the Discord callback is a
 * TOP-LEVEL GET arriving from another origin, which `strict` would strip the
 * cookie from — the sign-in would silently never complete. `lax` plus the
 * `X-Requested-With` header on every mutation is the pair section 6 specifies.
 * The attribute is asserted by the first test named above; what `strict` would
 * do to a real browser is a statement about browsers, held by nothing here.
 */
export interface CookieAttributes {
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: 'lax';
  readonly path: '/';
  /** SECONDS. `@fastify/cookie` writes it straight into `Max-Age`. */
  readonly maxAge: number;
}

const BASE: Omit<CookieAttributes, 'maxAge'> = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

/** 30 days, as section 6 and the fiche both spell it. */
export const sessionCookieAttributes: CookieAttributes = {
  ...BASE,
  maxAge: SESSION_MAX_AGE_MS / 1000,
};

/** The round-trip cookies live exactly as long as the `oauth_states` row. */
export const oauthCookieAttributes: CookieAttributes = {
  ...BASE,
  maxAge: OAUTH_STATE_TTL_MS / 1000,
};

/**
 * What clears a cookie: the SAME attributes, so the browser drops the entry it
 * actually holds rather than adding a second one on another path.
 *
 * `maxAge: 0` IS NOT WHAT PRODUCES `Max-Age=0` ON THE WIRE, and saying
 * otherwise would be a comment promising something it does not do. Measured:
 * `@fastify/cookie`'s `clearCookie` overwrites `maxAge` and `expires` itself,
 * so this object still serialises to `Max-Age=0; Expires=Thu, 01 Jan 1970`
 * when the field is set to 600. The field is here because `CookieAttributes`
 * demands one; what this object really contributes is `Path`, `SameSite`,
 * `Secure` and `HttpOnly`.
 *
 * The `Max-Age=0` that DOES reach the browser is held — by
 * `expectOauthCookiesCleared` of `tests/http/oauth.test.ts` and by « révoque
 * la session, et efface le cookie … » of `tests/http/session.test.ts`. What no
 * test holds is the sentence above about this field, which is why it is
 * written as a measurement and not as a guarantee.
 */
export const clearedCookieAttributes: CookieAttributes = { ...BASE, maxAge: 0 };
