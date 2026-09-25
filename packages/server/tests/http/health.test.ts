/**
 * The three probes, measured IN BOTH DIRECTIONS wherever a direction exists.
 *
 * `/healthz` answers 200 WITHOUT the database — and "without" is proven, not
 * asserted: the app is built over a connection that throws on any access at
 * all. A future edit that adds a single query to the liveness probe makes this
 * file red. The 200 alone would prove nothing; a probe that reads a healthy
 * database also answers 200.
 *
 * `/readyz` is measured on the same file before and after the migrations, so
 * the 503 and the 200 differ by exactly one thing.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GENERATED_FILES, GENERATED_HASH, staticContent } from '@for/content';
import {
  zAdminHealthResponse,
  zAppErrorPayload,
  zHealthzResponse,
  zReadyzResponse,
} from '@for/contracts';
import { createDb, migrateConnection } from '@for/db';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { campaignRng, createUlidFactory } from '../../src/deps.js';
import { readEnv } from '../../src/env.js';
import { AppError, installErrorHandling } from '../../src/errors.js';
import {
  expectedMigrationCount,
  healthRoutes,
  recomputeContentHash,
} from '../../src/http/health.js';
import { createLogger } from '../../src/logger.js';

import type { SqliteConnection } from '@for/db';
import type { FastifyInstance } from 'fastify';
import type { AppDeps, TimeSource } from '../../src/deps.js';

const BOOT_MS = 1_700_000_000_000;

/** A valid configuration. Every test starts from this and changes one thing. */
function envVars(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '8787',
    PUBLIC_URL: 'http://localhost:5173',
    LOG_LEVEL: 'fatal',
    DATABASE_PATH: join(tmpdir(), 'for-health-test.db'),
    SESSION_SECRET: 'a'.repeat(32),
    DISCORD_CLIENT_ID: 'client-id',
    DISCORD_CLIENT_SECRET: 'client-secret',
    DISCORD_REDIRECT_URI: 'http://localhost:8787/api/auth/discord/callback',
    NARRATOR_PROVIDER: 'stub',
    ...overrides,
  };
}

/** Nothing reaches a terminal during a test run. */
const SILENT = { write: (): void => undefined };

/**
 * A connection that RECORDS every touch, then throws.
 *
 * Recording is the part that matters. A proxy that only threw would be caught
 * by any handler wrapping its query in a `try`, and the test would go green on
 * a `/healthz` that reads SQLite on every liveness probe — measured, not
 * assumed: making the probe call `databaseResponds` left the throwing-only
 * version of this file green, because that helper swallows the exception. The
 * assertion is therefore on the LIST of touches, which nothing can swallow.
 */
function tripwire(what: string): { value: unknown; touches: string[] } {
  const touches: string[] = [];
  const value = new Proxy(
    {},
    {
      get(_target, property) {
        touches.push(String(property));
        throw new Error(`la sonde a touché ${what} : .${String(property)}`);
      },
    },
  );
  return { value, touches };
}

function depsOver(connection: SqliteConnection, elapsedMs = 0): AppDeps {
  const clock: TimeSource = { now: () => BOOT_MS + elapsedMs };
  return {
    env: readEnv(envVars()),
    logger: createLogger({ level: 'fatal', nodeEnv: 'test' }, SILENT),
    connection,
    // Tripwired on purpose: no health probe goes through Drizzle. They read the
    // raw connection, and the day one of them reaches for the query layer this
    // file says so instead of passing.
    db: tripwire('la couche Drizzle').value as AppDeps['db'],
    content: staticContent(),
    clock,
    rng: campaignRng,
    ids: createUlidFactory(clock),
    startedAt: BOOT_MS,
  };
}

interface Bed {
  readonly app: FastifyInstance;
  readonly close: () => Promise<void>;
}

const open: Bed[] = [];
const folders: string[] = [];

async function bedOver(connection: SqliteConnection, elapsedMs = 0): Promise<FastifyInstance> {
  const app = await buildApp(depsOver(connection, elapsedMs));
  open.push({ app, close: () => app.close() });
  return app;
}

/** A migrated-or-not database on a real file: WAL is downgraded in memory. */
function freshFile(): { path: string; connection: SqliteConnection } {
  const folder = mkdtempSync(join(tmpdir(), 'for-server-health-'));
  folders.push(folder);
  const path = join(folder, 'app.db');
  return { path, connection: createDb(path).connection };
}

afterEach(async () => {
  for (const bed of open.splice(0)) await bed.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('/healthz', () => {
  it('répond 200 sans jamais toucher la base', async () => {
    const wire = tripwire('la base');
    const app = await bedOver(wire.value as SqliteConnection, 4242);

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    // THE assertion of this file: not a single property of the connection was
    // read. A 200 alone would be just as true of a probe that queries a
    // healthy database — or of one that queries and swallows the failure.
    expect(wire.touches).toEqual([]);

    const body = zHealthzResponse.parse(response.json());
    expect(body.status).toBe('ok');
    expect(body.version).not.toBe('');
    expect(body.uptimeMs).toBe(4242);
  });

  it('le fil-piège mord bien : /readyz, lui, touche la base', async () => {
    // The other direction. Without it the assertion above would also hold for
    // a tripwire that records nothing at all.
    const wire = tripwire('la base');
    const app = await bedOver(wire.value as SqliteConnection);

    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(wire.touches).not.toEqual([]);
    expect(response.statusCode).toBe(503);
    expect(zReadyzResponse.parse(response.json()).database).toBe(false);
  });
});

describe('/readyz', () => {
  it('répond 503 tant que les migrations ne sont pas appliquées, 200 après', async () => {
    const { connection } = freshFile();

    const before = await (await bedOver(connection)).inject({ method: 'GET', url: '/readyz' });
    expect(before.statusCode).toBe(503);
    expect(zReadyzResponse.parse(before.json())).toEqual({
      status: 'not_ready',
      database: true,
      migrations: false,
    });

    migrateConnection(connection);

    const after = await (await bedOver(connection)).inject({ method: 'GET', url: '/readyz' });
    expect(after.statusCode).toBe(200);
    expect(zReadyzResponse.parse(after.json())).toEqual({
      status: 'ready',
      database: true,
      migrations: true,
    });
  });

  it('répond 503 quand le schéma est là mais la trace des migrations est incomplète', async () => {
    // THE OTHER HALF OF THE PROBE. The test above only ever meets a database
    // where `__drizzle_migrations` does not exist at all: the `prepare` throws
    // and the `catch` answers false, so the COMPARISON of the two counts is
    // never reached. The case that matters at a deployment is this one — the
    // schema is there, the applied trace is short of what the repository
    // ships — and it is the case a container would otherwise declare ready on
    // a stale schema. Measured: `>= expected` weakened to `>= 0` turns this
    // red and leaves every other test in the file green.
    const { connection } = freshFile();
    migrateConnection(connection);
    // Without this the case would be vacuous: zero expected migrations are
    // trivially applied, and the assertion below would hold for any code.
    expect(expectedMigrationCount()).toBeGreaterThan(0);
    connection.prepare('DELETE FROM __drizzle_migrations').run();

    const response = await (await bedOver(connection)).inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(503);
    expect(zReadyzResponse.parse(response.json())).toEqual({
      status: 'not_ready',
      database: true,
      migrations: false,
    });
  });
});

describe('/api/admin/health', () => {
  it("échoue fermé tant que le greffon d'authentification n'expose pas requireAdmin", async () => {
    const { connection } = freshFile();
    migrateConnection(connection);
    const app = await bedOver(connection);

    const response = await app.inject({ method: 'GET', url: '/api/admin/health' });

    expect(response.statusCode).toBe(401);
    expect(zAppErrorPayload.parse(response.json()).code).toBe('unauthenticated');
  });

  it('sert les cinq lignes du diagnostic une fois le garde posé', async () => {
    const { connection } = freshFile();
    migrateConnection(connection);
    // Fastify refuses a decorator added after `ready()`, and `buildApp` readies
    // — which is exactly how it works in production: the auth plugin decorates
    // DURING its registration. So this direction is measured on an instance
    // built the same way M0-23 will build it, around the same `healthRoutes`.
    const app = Fastify();
    app.decorate('requireAdmin', () => undefined);
    void app.register(healthRoutes, { deps: depsOver(connection) });
    await app.ready();
    open.push({ app, close: () => app.close() });

    const response = await app.inject({ method: 'GET', url: '/api/admin/health' });

    expect(response.statusCode).toBe(200);
    const body = zAdminHealthResponse.parse(response.json());
    expect(body.quickCheck).toBe('ok');
    // TWO INDEPENDENT READINGS, and this time there really are two: the digest
    // `health.ts` recomputes from `GENERATED_FILES`, and the one
    // `content:index` committed as `GENERATED_HASH`. The first version of this
    // line compared `body.contentHash` to `body.contentHashExpected` while
    // both came from `GENERATED_HASH` — a value compared to itself, green on a
    // bundle whose announced hash was `deadbeef…`.
    expect(body.contentHash).toBe(GENERATED_HASH);
    expect(body.contentHashExpected).toBe(GENERATED_HASH);
  });

  it('recalcule le hachage du contenu au lieu de recopier celui du paquet', async () => {
    // The direction that kills the tautology for good: one of the two sources
    // is corrupted — a bundle that ANNOUNCES a false hash — and the route must
    // still report what the files actually say. Reading
    // `deps.content.bundle.hash` back, as the first version did, makes this
    // test red.
    const { connection } = freshFile();
    migrateConnection(connection);
    const registry = staticContent();
    const lying = {
      ...registry,
      bundle: { ...registry.bundle, hash: 'deadbeef'.repeat(8) },
    } as typeof registry;

    const app = Fastify();
    app.decorate('requireAdmin', () => undefined);
    void app.register(healthRoutes, { deps: { ...depsOver(connection), content: lying } });
    await app.ready();
    open.push({ app, close: () => app.close() });

    const response = await app.inject({ method: 'GET', url: '/api/admin/health' });

    const body = zAdminHealthResponse.parse(response.json());
    expect(body.contentHash).not.toBe('deadbeef'.repeat(8));
    expect(body.contentHash).toBe(GENERATED_HASH);
  });

  it('un octet changé dans un fichier de contenu fait diverger le hachage recalculé', () => {
    // The other corrupted source: the files. Without this, "recomputed" would
    // be a word in a comment — a digest that never moves proves nothing.
    const file = 'champions/braum.json';
    expect(GENERATED_FILES[file]).toBeDefined();
    const document = JSON.parse(GENERATED_FILES[file] ?? '{}') as Record<string, unknown>;
    const corrupted = {
      ...GENERATED_FILES,
      [file]: JSON.stringify({ ...document, name: 'Braumm' }),
    };

    expect(recomputeContentHash(corrupted)).not.toBe(GENERATED_HASH);
    // And back the other way, on the shipped files, untouched.
    expect(recomputeContentHash()).toBe(GENERATED_HASH);
  });
});

describe('la surface d’erreur', () => {
  it('rend un AppErrorPayload, avec un requestId, sur une route inconnue', async () => {
    const app = await bedOver(tripwire('la base').value as SqliteConnection);

    const response = await app.inject({ method: 'GET', url: '/rien-du-tout' });

    expect(response.statusCode).toBe(404);
    const body = zAppErrorPayload.parse(response.json());
    expect(body.code).toBe('route_not_found');
    expect(body.requestId).not.toBe('');
  });

  it('ne laisse pas « details » traverser vers le client', async () => {
    // ASSERTED ON THE RAW KEYS, never through `zAppErrorPayload.parse`:
    // the contract is a non-strict `z.object`, so parsing STRIPS a surnumerary
    // key and the test would observe the payload through the very filter that
    // sanitises it. Measured: sending `details` alongside the payload left the
    // 28 tests of the package green before this one existed.
    const app = Fastify();
    installErrorHandling(app);
    app.get('/boum', () => {
      throw new AppError('internal_error', 500, 'Une erreur interne est survenue.', {
        sql: 'SELECT token FROM sessions',
      });
    });
    await app.ready();
    open.push({ app, close: () => app.close() });

    const response = await app.inject({ method: 'GET', url: '/boum' });

    expect(response.statusCode).toBe(500);
    // The three keys of `zAppErrorPayload`, written out in full here rather
    // than derived from the schema the handler already uses.
    expect(Object.keys(response.json()).sort()).toEqual(['code', 'message', 'requestId']);
    expect(response.body).not.toContain('SELECT token');
  });
});
