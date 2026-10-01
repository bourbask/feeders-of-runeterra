import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONTEUR_PROMPT_VERSION } from '@for/ai';
import type { NarrateEvent, NarrateRequest, NarratorPort } from '@for/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { CASES_DIR } from './cases.js';
import { buildConfig, main, RecordError, recordRequests } from './record.js';

const made: string[] = [];
const corpusCopy = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'for-m027-record-'));
  made.push(dir);
  cpSync(CASES_DIR, dir, { recursive: true });
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const silent = { out: (): void => undefined, err: (): void => undefined };

/**
 * A double TYPED AS THE REAL PORT.
 *
 * `NarratorPort` is the annotation, so the compiler refuses a `narrer` that
 * takes fewer parameters than the real one or returns something else. A
 * structurally-inferred double would have compiled with a narrower signature,
 * and the argument it dropped would have stopped existing for this suite
 * (`docs/RECETTE.md`, mode 8).
 */
function fakePort(answers: readonly string[]): NarratorPort {
  let at = 0;
  return {
    providerId: 'stub',
    capabilities: {
      streaming: false,
      tools: false,
      structuredOutput: false,
      promptCache: false,
      contextWindowTokens: 8192,
      maxCacheBreakpoints: 0,
    },
    narrer(request: NarrateRequest): AsyncIterable<NarrateEvent> {
      const text = `${answers[at % answers.length] ?? ''} [${request.requestId}]`;
      at += 1;
      return {
        async *[Symbol.asyncIterator]() {
          await Promise.resolve();
          yield {
            type: 'end',
            result: {
              text,
              finish: 'complete',
              providerModel: 'faux-modele',
              toolCalls: [],
              latencyMs: 0,
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
            },
          } satisfies NarrateEvent;
        },
      };
    },
    structurer() {
      return Promise.reject(new Error('non utilisé par eval:record'));
    },
  };
}

describe('eval:record', () => {
  it('réécrit les instantanés de requête sans toucher au réseau', () => {
    const dir = corpusCopy();
    const written = recordRequests(dir, silent);
    expect(written).toBeGreaterThan(0);
    expect(existsSync(join(dir, '01-issue-franche.request.json'))).toBe(true);
  });

  it('--requests-only sort en zéro sans fournisseur ni clé', async () => {
    expect(await main(['--requests-only'], {}, silent, {}, corpusCopy())).toBe(0);
  });

  it('sans --requests-only et sans fournisseur, sort en un en disant quoi faire', async () => {
    const errors: string[] = [];
    const code = await main(
      [],
      {},
      { out: () => undefined, err: (line) => errors.push(line) },
      {},
      corpusCopy(),
    );
    expect(code).toBe(1);
    expect(errors.join('\n')).toMatch(/--provider=/u);
    expect(errors.join('\n')).toMatch(/--requests-only/u);
  });

  it('refuse un fournisseur dont l’environnement est incomplet', () => {
    expect(() => buildConfig('anthropic', {})).toThrow(RecordError);
    expect(() => buildConfig('anthropic', {})).toThrow(/NARRATOR_API_KEY/u);
    expect(buildConfig('stub', {}).provider).toBe('stub');
  });

  it('écrit deux échantillons par cas, datés et versionnés', async () => {
    const dir = corpusCopy();
    const code = await main(
      ['--provider=stub'],
      {},
      silent,
      {
        selectPort: () => fakePort(['Tu montes.', 'Tu redescends.']),
        now: () => new Date('2026-10-01T00:00:00.000Z'),
      },
      dir,
    );
    expect(code).toBe(0);
    const written = JSON.parse(
      readFileSync(join(dir, '01-issue-franche.recorded.json'), 'utf8'),
    ) as { samples: { response: string }[]; prompt_version: string; recorded_at: string };
    expect(written.samples).toHaveLength(2);
    expect(written.prompt_version).toBe(CONTEUR_PROMPT_VERSION);
    expect(written.recorded_at).toBe('2026-10-01T00:00:00.000Z');
    // Le `requestId` passé au port est celui du cas : la requête enregistrée est bien la sienne.
    expect(written.samples[0]?.response).toMatch(/\[01-issue-franche\]/u);
  });
});
