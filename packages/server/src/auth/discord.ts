/**
 * The Discord side of the OAuth round trip: PKCE, the authorisation URL, the
 * token exchange and `GET /users/@me` (01-architecture.md section 6).
 *
 * NOTHING HERE TOUCHES THE DATABASE AND NOTHING HERE READS THE PROCESS. The
 * client is built from an `Env` that `src/env.ts` already validated, and its
 * `fetch` is a PARAMETER. That is what makes `tests/http/*.test.ts` able to
 * drive the whole flow with no network at all: the tests pass a function, not
 * a mock of a global.
 *
 * PKCE IS NOT OPTIONAL HERE EVEN THOUGH THE CLIENT IS CONFIDENTIAL. A public
 * repository plus a secret the project owner could not read back (it is shown
 * once) means the authorisation code is the part of the flow most likely to
 * leak; S256 makes a stolen code useless without the verifier, which never
 * leaves this process except as its own hash.
 *
 * THE SCOPE IS `identify` ALONE, reported rather than slipped in.
 * `players.discord_email` exists and its comment says "scope `email`; null
 * when the player did not grant it". M0 asks nobody for an e-mail address: the
 * product needs a name and a face, the column stays null, and a scope that is
 * not requested is a scope that cannot leak from a public deployment.
 */

import type { Env } from '../env.js';

/** The three Discord endpoints, pinned to the API version we read. */
export const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
export const DISCORD_TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';
export const DISCORD_USER_URL = 'https://discord.com/api/v10/users/@me';

/** See the header: `identify` and nothing else. */
export const DISCORD_SCOPES = ['identify'] as const;

/** The only challenge method this server ever sends. Plain is not an option. */
export const PKCE_METHOD = 'S256';

export interface DiscordTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresIn: number;
  readonly scope: string;
}

/** The subset of `/users/@me` this product stores. */
export interface DiscordUser {
  readonly id: string;
  readonly username: string;
  readonly globalName: string | null;
  readonly avatar: string | null;
}

export interface ExchangeInput {
  readonly code: string;
  readonly codeVerifier: string;
}

export interface DiscordClient {
  exchangeCode(input: ExchangeInput): Promise<DiscordTokens>;
  fetchUser(accessToken: string): Promise<DiscordUser>;
}

/**
 * Discord answered something this server cannot use.
 *
 * The message NEVER carries the response body: a token endpoint that fails
 * echoes back parts of the request, and one of those parts is the client
 * secret. The body goes in `details`, which `errors.ts` keeps out of the wire.
 */
export class DiscordCallError extends Error {
  constructor(
    readonly step: 'token' | 'user',
    readonly status: number,
    readonly details: unknown,
  ) {
    super(`Discord a refusé l'étape « ${step} » (HTTP ${String(status)})`);
    this.name = 'DiscordCallError';
  }
}

/**
 * The URL the browser is sent to.
 *
 * Built with `URLSearchParams` rather than by concatenation: `state` and the
 * challenge are base64url, which contains `-` and `_` and no `+` or `/`, but
 * the redirect URI is a full URL and MUST be percent-encoded or Discord
 * rejects the request with an error a developer then spends an hour on.
 */
export function authorizeUrl(
  env: Env,
  input: { readonly state: string; readonly codeChallenge: string },
): string {
  const query = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: env.DISCORD_REDIRECT_URI,
    scope: DISCORD_SCOPES.join(' '),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: PKCE_METHOD,
  });
  return `${DISCORD_AUTHORIZE_URL}?${query.toString()}`;
}

/** What `createDiscordClient` calls. `globalThis.fetch` in production. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The real client. One `fetch` per step, no retry, no backoff.
 *
 * A retry would be wrong here rather than merely absent: an authorisation code
 * is single-use, so replaying a failed exchange asks Discord to burn a code
 * that may already have been spent. The player retries by signing in again,
 * which mints a new code — the only correct recovery.
 */
export function createDiscordClient(
  env: Env,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): DiscordClient {
  return {
    async exchangeCode(input: ExchangeInput): Promise<DiscordTokens> {
      const body = new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: env.DISCORD_REDIRECT_URI,
        code_verifier: input.codeVerifier,
      });

      const response = await fetchImpl(DISCORD_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new DiscordCallError('token', response.status, payload);
      }

      const record = (payload ?? {}) as Record<string, unknown>;
      const accessToken = asString(record['access_token']);
      if (accessToken === null) {
        throw new DiscordCallError('token', response.status, 'access_token absent');
      }
      return {
        accessToken,
        refreshToken: asString(record['refresh_token']),
        expiresIn: typeof record['expires_in'] === 'number' ? record['expires_in'] : 0,
        scope: asString(record['scope']) ?? '',
      };
    },

    async fetchUser(accessToken: string): Promise<DiscordUser> {
      const response = await fetchImpl(DISCORD_USER_URL, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new DiscordCallError('user', response.status, payload);
      }

      const record = (payload ?? {}) as Record<string, unknown>;
      const id = asString(record['id']);
      const username = asString(record['username']);
      if (id === null || username === null) {
        throw new DiscordCallError('user', response.status, 'id ou username absent');
      }
      return {
        id,
        username,
        globalName: asString(record['global_name']),
        avatar: asString(record['avatar']),
      };
    },
  };
}

/**
 * The URL of a player's avatar, or `null` when they never set one.
 *
 * Discord's default avatars are computed from the snowflake and served from
 * another path; answering `null` lets the client draw its own placeholder
 * rather than depend on a CDN convention that changed once already.
 */
export function avatarUrl(discordUserId: string, avatarHash: string | null): string | null {
  if (avatarHash === null) return null;
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.png`;
}
