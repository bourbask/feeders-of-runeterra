/**
 * Redaction, measured in both directions.
 *
 * ONE DIRECTION PROVES NOTHING HERE. A record that comes out without the
 * secret could just as well be a record pino never serialised. So the same
 * record goes through a logger built WITHOUT `redact`, and the secret shows up
 * in the bytes — which is what makes the first assertion mean "the redaction
 * list did this".
 *
 * The paths are written out by hand rather than looped from `REDACTED_PATHS`:
 * a test that iterates the list it checks goes green when the list is emptied.
 * Deleting `NARRATOR_API_KEY` from `logger.ts` must turn this file red, and
 * that is only true if the name is typed here too.
 *
 * (This file is not in M0-20's « Fichiers touchés » either — see the header of
 * `env.test.ts`; the gap is reported in the PR, not worked around.)
 */

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { REDACTION_PLACEHOLDER, createLogger } from './logger.js';

import type { DestinationStream } from 'pino';

const SECRET = 'TOP-SECRET-VALEUR-QUI-NE-DOIT-PAS-SORTIR';

/** Collects whatever pino writes, line by line. */
function capture(): { stream: DestinationStream; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    stream: {
      write(chunk: string) {
        lines.push(chunk);
      },
    },
  };
}

/** One record carrying a secret in every shape section 3.4 names. */
const RECORD = {
  req: { headers: { cookie: `fr_session=${SECRET}`, authorization: `Bearer ${SECRET}` } },
  res: { headers: { 'set-cookie': `fr_session=${SECRET}` } },
  accessToken: SECRET,
  session: { refreshToken: SECRET, accessToken: SECRET },
  NARRATOR_API_KEY: SECRET,
  DISCORD_CLIENT_SECRET: SECRET,
  config: { NARRATOR_API_KEY: SECRET, DISCORD_CLIENT_SECRET: SECRET },
  SESSION_SECRET: SECRET,
};

describe('la rédaction des secrets', () => {
  it('ne laisse pas un cookie ni une NARRATOR_API_KEY sortir dans le journal', () => {
    const { stream, lines } = capture();
    const logger = createLogger({ level: 'info', nodeEnv: 'test' }, stream);

    logger.info(RECORD, 'requête servie');

    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    expect(line).not.toContain(SECRET);

    const parsed = JSON.parse(line) as Record<string, unknown>;
    const req = parsed['req'] as { headers: Record<string, string> };
    const config = parsed['config'] as Record<string, string>;
    const session = parsed['session'] as Record<string, string>;

    expect(req.headers['cookie']).toBe(REDACTION_PLACEHOLDER);
    expect(req.headers['authorization']).toBe(REDACTION_PLACEHOLDER);
    expect(parsed['NARRATOR_API_KEY']).toBe(REDACTION_PLACEHOLDER);
    expect(config['NARRATOR_API_KEY']).toBe(REDACTION_PLACEHOLDER);
    expect(parsed['DISCORD_CLIENT_SECRET']).toBe(REDACTION_PLACEHOLDER);
    expect(parsed['SESSION_SECRET']).toBe(REDACTION_PLACEHOLDER);
    expect(parsed['accessToken']).toBe(REDACTION_PLACEHOLDER);
    expect(session['refreshToken']).toBe(REDACTION_PLACEHOLDER);
  });

  it('LE MÊME enregistrement fuite sans la liste de rédaction', () => {
    const { stream, lines } = capture();

    pino({ level: 'info' }, stream).info(RECORD, 'requête servie');

    expect(lines[0] ?? '').toContain(SECRET);
  });
});

describe('le niveau de journalisation', () => {
  it('est celui de LOG_LEVEL : un debug ne sort pas sous info', () => {
    const { stream, lines } = capture();
    const logger = createLogger({ level: 'info', nodeEnv: 'test' }, stream);

    logger.debug('détail de pipeline');
    expect(lines).toHaveLength(0);

    logger.info('cycle de vie');
    expect(lines).toHaveLength(1);
  });
});
