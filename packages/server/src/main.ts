/**
 * THE PROCESS ENTRY POINT. Loads the environment, opens the database, migrates
 * it, builds the app, listens.
 *
 * THE ORDER IS THE CONTRACT. The environment is read FIRST, before a file is
 * opened or a byte of content is parsed, so that a deployment missing
 * `SESSION_SECRET` dies on that sentence and not on some later symptom of it.
 * `node dist/main.js` with a hole in the configuration exits 1 and writes the
 * name of the variable on stderr — an operator can act on a variable name and
 * cannot act on a stack trace.
 *
 * "MIGRATES UNDER A LOCK", said plainly: the lock is SQLite's own. Drizzle's
 * migrator runs the whole batch inside one transaction, and `@for/db` sets
 * `busy_timeout = 5000` on every connection it opens, so a second process
 * starting in the same second WAITS for the first rather than interleaving
 * with it. There is no second lock to take. Wrapping the call in a
 * `BEGIN IMMEDIATE` of our own would only produce a nested-transaction error
 * and would look, in a diff, exactly like a guard-rail.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';

import { staticContent } from '@for/content';
import { createDb, migrateConnection } from '@for/db';

import { buildApp } from './app.js';
import { campaignRng, createUlidFactory, systemClock } from './deps.js';
import { EnvError, readEnv } from './env.js';
import { createLogger } from './logger.js';

import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { AppDeps } from './deps.js';

/** Signals a container sends. Both mean the same thing: stop cleanly. */
const STOP_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

function installShutdown(app: FastifyInstance, close: () => void, logger: Logger): void {
  let stopping = false;
  for (const signal of STOP_SIGNALS) {
    process.once(signal, () => {
      if (stopping) return;
      stopping = true;
      logger.info({ signal }, 'arrêt demandé');
      void app
        .close()
        .catch((error: unknown) => {
          logger.error({ err: error }, "échec de la fermeture de l'application");
        })
        .finally(() => {
          close();
          process.exit(0);
        });
    });
  }
}

async function main(): Promise<void> {
  const env = readEnv();
  const startedAt = systemClock.now();
  const logger = createLogger({ level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV });

  mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
  const { connection, db } = createDb(env.DATABASE_PATH);
  migrateConnection(connection);

  const deps: AppDeps = {
    env,
    logger,
    connection,
    db,
    content: staticContent(),
    clock: systemClock,
    rng: campaignRng,
    ids: createUlidFactory(systemClock),
    startedAt,
  };

  const app = await buildApp(deps);
  installShutdown(
    app,
    () => {
      connection.close();
    },
    logger,
  );

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  // No logger yet, and deliberately so: a configuration error must be legible
  // on stderr of a container that never got far enough to have one.
  const message = error instanceof EnvError ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  if (!(error instanceof EnvError) && error instanceof Error && error.stack !== undefined) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exit(1);
});
