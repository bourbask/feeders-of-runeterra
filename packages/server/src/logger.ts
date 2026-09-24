/**
 * `pino`, and the redaction list of 01-architecture.md section 3.4.
 *
 * THE REPOSITORY IS PUBLIC AND THE LOGS ARE NOT. A session cookie or a
 * narrator key that reaches a log line has left the process: it is in a file,
 * in a journald ring buffer, in whatever ships logs off the host, and no
 * rotation takes it back. Redaction is therefore an acceptance criterion of
 * M0-20, not a nicety — and it is proven by writing a record that CONTAINS a
 * secret and asserting the secret is not in the bytes that come out.
 *
 * `logger.test.ts` does exactly that, with literal paths rather than a loop
 * over `REDACTED_PATHS`: a test that iterates the list it is checking goes
 * green when the list is emptied, which is the sixth way this repository has
 * already been lied to by a guard-rail.
 */

import { pino } from 'pino';

import type { DestinationStream, Logger, LoggerOptions } from 'pino';
import type { Env } from './env.js';

/** What replaces a redacted value. French, because a human reads it. */
export const REDACTION_PLACEHOLDER = '[rédigé]';

/**
 * Section 3.4's list, plus the bare forms.
 *
 * The bare forms matter: section 3.4 writes `*.accessToken`, and a pino
 * wildcard covers ONE level, so a token logged at the top of the record —
 * `log.info({ accessToken })`, the shortest way anyone would write it — would
 * go through untouched with the starred path alone.
 *
 * `set-cookie` is an addition, reported rather than slipped in: the response
 * that MINTS the session cookie is the one worth logging, and it carries the
 * secret in a header section 3.4 does not name.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'NARRATOR_API_KEY',
  '*.NARRATOR_API_KEY',
  'DISCORD_CLIENT_SECRET',
  '*.DISCORD_CLIENT_SECRET',
  'SESSION_SECRET',
  '*.SESSION_SECRET',
] as const;

export interface LoggerInput {
  readonly level: Env['LOG_LEVEL'];
  readonly nodeEnv: Env['NODE_ENV'];
}

function baseOptions(input: LoggerInput): LoggerOptions {
  return {
    level: input.level,
    redact: { paths: [...REDACTED_PATHS], censor: REDACTION_PLACEHOLDER },
    // A narration is never logged whole at `info` (section 3.4): the full text
    // lives in the database, and the log would carry its volume for nothing.
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
}

/**
 * Builds the process logger.
 *
 * `destination` is what the tests give it. In production nothing is passed and
 * pino writes JSON on stdout; in development it goes through `pino-pretty`,
 * which is a worker thread and therefore never used by a test.
 */
export function createLogger(input: LoggerInput, destination?: DestinationStream): Logger {
  const options = baseOptions(input);
  if (destination !== undefined) {
    return pino(options, destination);
  }
  if (input.nodeEnv === 'development') {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }
  return pino(options);
}
