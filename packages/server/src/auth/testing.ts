/**
 * The bench `tests/http/*.test.ts` drive. NOT re-exported by `src/index.ts`.
 *
 * WHY IT LIVES UNDER `src/` AND NOT UNDER `tests/`, which is where a reader
 * looks first: the repository's flat ESLint config maps `**\/*.test.ts` to
 * `tsconfig.test.json` and everything else to the project service, which only
 * sees `src/**`. A support file under `tests/` is therefore in NO TypeScript
 * program at all and `pnpm lint` stops on "not found by the project service".
 * `@for/db` hit the same wall and answered it the same way (`db/src/testing.ts`);
 * this is that precedent, not a new idea.
 *
 * THE BENCH COMPOSES THE APPLICATION THE WAY `app.ts` DOES, and that is safe
 * for one reason only: `app.ts` is closed. Its own header says it "is not
 * modified again" — it exists so three agents can fill `auth/`, `ws/` and
 * `game/` in parallel without serialising behind one merge. A mirror of a file
 * that never changes cannot drift. `tests/http/composition.test.ts` measures
 * the claim anyway, on an application built by the REAL `buildApp`.
 *
 * WHY A MIRROR AT ALL: the Discord client is an option of `authPlugin`, not a
 * field of `AppDeps`, so that `deps.ts` and `main.ts` — neither of which
 * belongs to M0-23 — stayed shut. `buildApp` passes `{ deps }` and gets the
 * real client; a test passes `{ deps, discord }` and drives the whole OAuth
 * round trip with no socket open anywhere.
 *
 * A REAL FILE, NEVER `:memory:`. `journal_mode = WAL` is silently downgraded
 * on an in-memory database, so a suite built on it would measure a different
 * engine from the one production runs.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { staticContent } from '@for/content';
import { SESSION_COOKIE_NAME } from '@for/contracts';
import { migrateFile } from '@for/db';
import Fastify from 'fastify';

import { campaignRng, createUlidFactory } from '../deps.js';
import { readEnv } from '../env.js';
import { installErrorHandling } from '../errors.js';
import { healthRoutes } from '../http/health.js';
import { httpPlugin } from '../http/index.js';
import { createLogger } from '../logger.js';
import { authPlugin } from './index.js';
import { createSession, hashSecret } from './session.js';

import type { SqliteConnection } from '@for/db';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import type { AppDeps, TimeSource } from '../deps.js';
import type { DiscordClient, DiscordTokens, DiscordUser } from './discord.js';

/** A fixed instant, so every expiry in a test is arithmetic rather than luck. */
export const T0 = 1_700_000_000_000;

/** A clock a test moves by hand. `advance` is how an expiry is reached. */
export interface MovableClock extends TimeSource {
  advance(ms: number): void;
}

export function movableClock(start = T0): MovableClock {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** A valid configuration. Every test starts from this and changes one thing. */
export function envVars(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '8787',
    PUBLIC_URL: 'http://localhost:5173',
    LOG_LEVEL: 'fatal',
    DATABASE_PATH: join(tmpdir(), 'for-auth-test.db'),
    SESSION_SECRET: 'a'.repeat(32),
    DISCORD_CLIENT_ID: 'client-id',
    DISCORD_CLIENT_SECRET: 'client-secret-jamais-commite',
    DISCORD_REDIRECT_URI: 'http://localhost:8787/api/auth/discord/callback',
    NARRATOR_PROVIDER: 'stub',
    ...overrides,
  };
}

/** Nothing reaches a terminal during a test run. */
const SILENT = { write: (): void => undefined };

/** Throws on ANY property access. See its single use below. */
function drizzleTripwire(): AppDeps['db'] {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`une route a touché la couche Drizzle : .${String(property)}`);
      },
    },
  ) as AppDeps['db'];
}

/**
 * A Discord client that answers from memory and COUNTS ITS CALLS.
 *
 * The counter is the part that matters: "no network happened" is proven by
 * the refusal path calling neither method, which a client that merely returned
 * a canned answer could not show.
 *
 * EVERY METHOD HERE TAKES EVERY PARAMETER THE REAL INTERFACE PASSES IT, and
 * that is a rule rather than a style. TypeScript accepts a function that
 * declares FEWER parameters than the type it is assigned to, so `fetchUser:
 * () => …` compiled without a word while `DiscordClient.fetchUser` takes an
 * access token — and the token the callback hands it stopped existing for the
 * whole suite. Found on this file, not by coverage: `testing.ts` was already
 * executed everywhere. Eighth failure mode of `docs/RECETTE.md`, question 7.
 * `seen` therefore records the token too, and
 * `tests/http/oauth.test.ts`, `présente à /users/@me le jeton que l'échange a
 * rendu`, reads it back.
 */
export interface FakeDiscord extends DiscordClient {
  readonly calls: { exchange: number; user: number };
  readonly seen: { codes: string[]; verifiers: string[]; tokens: string[] };
}

export function fakeDiscord(user: DiscordUser, tokens: Partial<DiscordTokens> = {}): FakeDiscord {
  const calls = { exchange: 0, user: 0 };
  const seen = { codes: [] as string[], verifiers: [] as string[], tokens: [] as string[] };
  return {
    calls,
    seen,
    exchangeCode: (input) => {
      calls.exchange += 1;
      seen.codes.push(input.code);
      seen.verifiers.push(input.codeVerifier);
      return Promise.resolve({
        accessToken: 'jeton-d-acces',
        refreshToken: null,
        expiresIn: 604_800,
        scope: 'identify',
        ...tokens,
      });
    },
    fetchUser: (accessToken) => {
      calls.user += 1;
      seen.tokens.push(accessToken);
      return Promise.resolve(user);
    },
  };
}

export interface Bench {
  readonly app: FastifyInstance;
  readonly deps: AppDeps;
  readonly connection: SqliteConnection;
  readonly clock: MovableClock;
  readonly discord: FakeDiscord;
  readonly close: () => Promise<void>;
}

export interface BenchOptions {
  readonly discord?: FakeDiscord;
  readonly env?: Record<string, string>;
  /**
   * Collect every log line instead of dropping them, at `trace`.
   *
   * The loudest level on purpose: a redaction test must run against the
   * chattiest configuration the product can be put in, because that is the one
   * an operator reaches for when something is wrong.
   */
  readonly logs?: string[];
}

const DEFAULT_USER: DiscordUser = {
  id: '221503261830316032',
  username: 'kevinb',
  globalName: 'Kevin',
  avatar: 'a1b2c3',
};

/**
 * A migrated database on a real file, an application over it, and a clock.
 *
 * The registration order below is `app.ts`'s, verbatim: auth first (it
 * decorates, through `fastify-plugin`), then health, then the product routes.
 */
export async function bench(options: BenchOptions = {}): Promise<Bench> {
  const folder = mkdtempSync(join(tmpdir(), 'for-auth-bench-'));
  const path = join(folder, 'app.db');
  const connection = migrateFile(path);
  const clock = movableClock();
  const discord = options.discord ?? fakeDiscord(DEFAULT_USER);

  const env = readEnv(envVars({ DATABASE_PATH: path, ...options.env }));
  const sink = options.logs;
  const logger =
    sink === undefined
      ? createLogger({ level: 'fatal', nodeEnv: 'test' }, SILENT)
      : createLogger(
          { level: 'trace', nodeEnv: 'test' },
          {
            write: (line: string) => {
              sink.push(line);
            },
          },
        );
  const deps: AppDeps = {
    env,
    logger,
    connection,
    // TRIPWIRED, like `health.test.ts` does: nothing this task wrote goes
    // through Drizzle. The routes read the raw connection, and the day one of
    // them reaches for the query layer these tests say so instead of passing.
    db: drizzleTripwire(),
    content: staticContent(),
    clock,
    rng: campaignRng,
    ids: createUlidFactory(clock),
    startedAt: T0,
  };

  // Annotated, exactly as `app.ts` annotates it and for the same reason: an
  // inferred `loggerInstance` specialises Fastify's logger parameter to pino's
  // concrete `Logger`, and every plugin written against the plain
  // `FastifyInstance` then stops type-checking under `exactOptionalPropertyTypes`.
  const serverOptions: FastifyServerOptions = {
    loggerInstance: logger,
    genReqId: () => deps.ids.next(),
  };
  const app = Fastify(serverOptions);
  installErrorHandling(app);
  void app.register(authPlugin, { deps, discord });
  void app.register(healthRoutes, { deps });
  void app.register(httpPlugin, { deps });
  await app.ready();

  return {
    app,
    deps,
    connection,
    clock,
    discord,
    close: async () => {
      await app.close();
      connection.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

/** The `Set-Cookie` headers of a reply, always as an array. */
export function setCookies(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie'];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((line) => typeof line === 'string');
  return [];
}

/** The value of one cookie in a `Set-Cookie` list, or `null`. */
export function cookieValue(headers: Record<string, unknown>, name: string): string | null {
  for (const line of setCookies(headers)) {
    const [pair] = line.split(';');
    const [key, ...rest] = (pair ?? '').split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export interface SignedIn {
  /** The `fr_session` cookie value: 32 random bytes, base64url. */
  readonly secret: string;
  readonly playerId: string;
}

/**
 * A complete sign-in through the REAL routes: start, then callback.
 *
 * Deliberately not a hand-written row in `auth_sessions`: a fixture that
 * inserts its own session would let every assertion about `/api/me` pass while
 * the OAuth path was broken, which is the failure this whole file exists to
 * make impossible.
 */
export async function signIn(bed: Bench, code = 'code-discord'): Promise<SignedIn> {
  const start = await bed.app.inject({ method: 'GET', url: '/api/auth/discord/start' });
  const state = cookieValue(start.headers, 'fr_oauth_state');
  const verifier = cookieValue(start.headers, 'fr_oauth_verifier');
  if (state === null || verifier === null) throw new Error('le démarrage n’a pas posé ses cookies');

  const callback = await bed.app.inject({
    method: 'GET',
    url: `/api/auth/discord/callback?code=${code}&state=${encodeURIComponent(state)}`,
    cookies: { fr_oauth_state: state, fr_oauth_verifier: verifier },
  });

  const secret = cookieValue(callback.headers, SESSION_COOKIE_NAME);
  if (secret === null) {
    throw new Error(`le rappel n’a pas posé de session (HTTP ${String(callback.statusCode)})`);
  }

  // Read back BY THE HASH OF THE COOKIE, not by "the only row": rotation means
  // several rows can exist, and picking an arbitrary one would make a later
  // rotation test quietly assert about the wrong session.
  const row = bed.connection
    .prepare(`SELECT player_id FROM auth_sessions WHERE id = ?`)
    .get(hashSecret(secret)) as { player_id: string } | undefined;
  if (row === undefined) throw new Error('la session posée n’a pas de ligne');
  return { secret, playerId: row.player_id };
}

/**
 * A SECOND player, with a session, written straight into zone A.
 *
 * A SHORTCUT, AND IT IS BOUNDED. `signIn` above goes through the real OAuth
 * routes, and every claim about the flow rests on it; this one exists only so
 * a test can ask "what does SOMEBODY ELSE see", which a single fake Discord
 * identity cannot express. It writes the same two rows the callback writes,
 * with the secret hashed the same way — never the secret itself.
 */
export function fabricateSession(bed: Bench, discordUserId: string, username: string): SignedIn {
  const playerId = bed.deps.ids.next();
  const now = bed.clock.now();
  bed.connection
    .prepare(
      `INSERT INTO players (id, discord_user_id, discord_username, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(playerId, discordUserId, username, now, now);
  const session = createSession(bed.connection, { playerId, now });
  return { secret: session.secret, playerId };
}
