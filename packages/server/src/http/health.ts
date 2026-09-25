/**
 * The three health probes of 01-architecture.md section 6.
 *
 * THE SPLIT IS AN OPERATIONAL RULE BEFORE IT IS A ROUTE TABLE:
 *
 *   - `/healthz` answers 200 as long as the process answers at all. It does
 *     NOT open, ping or otherwise look at the database. A liveness probe that
 *     reads SQLite turns a locked write into a container restart, which is the
 *     one thing guaranteed to make a locked write worse;
 *   - `/readyz` pings the file and checks the migrations, and nothing else;
 *   - `/api/admin/health` is where everything expensive lives — `quick_check`,
 *     the WAL size, the backup age, the disk, the content hash — and it is
 *     ADMIN ONLY, because every one of those five lines describes the host.
 *
 * `healthz.test.ts` proves the first bullet by building the app with a
 * connection that THROWS on any access: if a future edit adds a query to
 * `/healthz`, the test goes red instead of the probe going quiet.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync, statfsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { GENERATED_FILES, GENERATED_HASH, contentHash } from '@for/content';
import {
  ADMIN_HEALTH_BACKUP_MAX_AGE_MS,
  ADMIN_HEALTH_MIN_FREE_DISK_RATIO,
  ADMIN_HEALTH_WAL_MAX_BYTES,
} from '@for/contracts';
import { MIGRATIONS_FOLDER } from '@for/db';

import { unauthenticated } from '../errors.js';

import type { AdminHealthResponse, HealthzResponse, ReadyzResponse } from '@for/contracts';
import type { SqliteConnection } from '@for/db';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps, AppPluginOptions } from '../deps.js';

/**
 * This package's own version, read from its manifest.
 *
 * `src/http/health.ts` and `dist/http/health.js` sit at the same depth under
 * `packages/server`, so one relative path serves the test run and the
 * container. Read once, at import: a version that changed under a running
 * process would be a lie either way.
 */
export const SERVER_VERSION: string = (() => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version?: string };
  return manifest.version ?? '0.0.0';
})();

/** Number of migrations the repository ships, from drizzle's own journal. */
export function expectedMigrationCount(): number {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries?: readonly unknown[] };
  return journal.entries?.length ?? 0;
}

/** A single cheap query. `false` means the file is gone, locked out or corrupt. */
export function databaseResponds(connection: SqliteConnection): boolean {
  try {
    connection.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether every migration the repository ships has been applied.
 *
 * TWO INDEPENDENT SOURCES, on purpose: the count comes from
 * `migrations/meta/_journal.json`, which the repository writes, and the
 * applied rows come from `__drizzle_migrations`, which the database writes. A
 * check that read one of them twice would be the "number compared to itself"
 * this repository has already paid for once.
 */
export function migrationsApplied(connection: SqliteConnection): boolean {
  const expected = expectedMigrationCount();
  try {
    const row = connection.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as
      { n: number } | undefined;
    return (row?.n ?? 0) >= expected;
  } catch {
    // The table itself is missing: nothing has ever been migrated.
    return false;
  }
}

/**
 * The content digest, RECOMPUTED from the files rather than read back.
 *
 * `deps.content.bundle.hash` cannot answer this question: `staticContent()`
 * hands `GENERATED_HASH` to `validateContent`, which copies it into the
 * bundle. Comparing that field to `GENERATED_HASH` compares a value to
 * itself — the fifth mode of "rule present and inert" (ADR 0007), and it is
 * what shipped here first. `contentHash(files, sha256)` and `GENERATED_FILES`
 * are the two exports that make the comparison real: the digest below is a
 * function of WHAT THE FILES SAY, `GENERATED_HASH` is what `content:index`
 * committed, and the two diverge as soon as either side is touched alone.
 *
 * Computed ONCE per import, not per request: `/api/admin/health` is allowed to
 * be expensive, a probe tick is not.
 */
function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Exported so a test can corrupt one of the two sources and demand the red. */
export function recomputeContentHash(
  files: Readonly<Record<string, string>> = GENERATED_FILES,
): string {
  return contentHash(new Map(Object.entries(files)), sha256);
}

const CONTENT_HASH: string = recomputeContentHash();

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function freeDiskRatio(path: string): number {
  try {
    const stats = statfsSync(dirname(path));
    const total = stats.blocks;
    if (total <= 0) return 0;
    return Math.min(1, Math.max(0, stats.bavail / total));
  } catch {
    return 0;
  }
}

/**
 * Age of the last backup, or `null` when none has ever run.
 *
 * M0 ALWAYS ANSWERS `null`, and the signature says `number | null` rather than
 * `null` on purpose: 01-architecture.md section 9.5 puts `backup.sh` on a host
 * cron, outside this process, and gives the server no variable saying where a
 * backup would land. Narrowing the type to `null` would make the threshold
 * below dead code that a linter deletes — and the threshold is the part that
 * has to survive until the cron exists.
 */
function lastBackupAge(): number | null {
  return null;
}

function quickCheck(connection: SqliteConnection): string {
  try {
    const rows = connection.pragma('quick_check') as { quick_check?: string }[];
    return rows[0]?.quick_check ?? 'unknown';
  } catch (error) {
    return error instanceof Error ? error.message : 'unknown';
  }
}

/**
 * The five lines of 03-donnees.md section 6.7 plus the server's verdict.
 *
 * `lastBackupAgeMs` is `null` in M0: no backup schedule is configured in the
 * repository (01-architecture.md section 9.5 puts `backup.sh` on a host cron,
 * outside the process), and the server has no variable telling it where a
 * backup would land. A `null` counts as UNHEALTHY rather than as "fine":
 * `@for/contracts` says in so many words that never having run is not the
 * same as having run recently, and an operator reading `healthy: false` with
 * `lastBackupAgeMs: null` learns the true thing.
 */
export function adminHealth(deps: AppDeps): AdminHealthResponse {
  const check = quickCheck(deps.connection);
  const walBytes = sizeOf(`${deps.env.DATABASE_PATH}-wal`);
  const lastBackupAgeMs = lastBackupAge();
  const ratio = freeDiskRatio(deps.env.DATABASE_PATH);

  return {
    quickCheck: check,
    walBytes,
    lastBackupAgeMs,
    freeDiskRatio: ratio,
    contentHash: CONTENT_HASH,
    contentHashExpected: GENERATED_HASH,
    healthy:
      check === 'ok' &&
      walBytes <= ADMIN_HEALTH_WAL_MAX_BYTES &&
      lastBackupAgeMs !== null &&
      lastBackupAgeMs <= ADMIN_HEALTH_BACKUP_MAX_AGE_MS &&
      ratio >= ADMIN_HEALTH_MIN_FREE_DISK_RATIO &&
      CONTENT_HASH === GENERATED_HASH,
  };
}

/**
 * Fails closed while `requireAdmin` is missing.
 *
 * The auth plugin (M0-23) installs that decorator. Until it does, the route
 * answers 401 rather than serving the host's disk usage to anybody who knows
 * the path — the alternative, "we will remember to guard it later", is how
 * admin routes get shipped open.
 */
function adminOnly(app: FastifyInstance) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const guard = app.requireAdmin;
    if (guard === undefined) {
      throw unauthenticated("le greffon d'authentification n'expose pas encore requireAdmin");
    }
    await guard(request, reply);
  };
}

export const healthRoutes: FastifyPluginCallback<AppPluginOptions> = (app, options, done) => {
  const { deps } = options;

  app.get('/healthz', (_request, reply) => {
    const body: HealthzResponse = {
      status: 'ok',
      version: SERVER_VERSION,
      uptimeMs: Math.max(0, deps.clock.now() - deps.startedAt),
    };
    void reply.status(200).send(body);
  });

  app.get('/readyz', (_request, reply) => {
    const database = databaseResponds(deps.connection);
    const migrations = database && migrationsApplied(deps.connection);
    const body: ReadyzResponse = {
      status: database && migrations ? 'ready' : 'not_ready',
      database,
      migrations,
    };
    void reply.status(body.status === 'ready' ? 200 : 503).send(body);
  });

  app.get('/api/admin/health', { preHandler: adminOnly(app) }, (_request, reply) => {
    void reply.status(200).send(adminHealth(deps));
  });

  done();
};
