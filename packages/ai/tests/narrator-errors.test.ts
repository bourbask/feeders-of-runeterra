/**
 * No HTTP status, no SDK class and no provider message crosses the port
 * (02-mj-ia.md section 0.1).
 *
 * The retry policy of section 7.1 is written against `NarratorErrorCode`, so
 * there is ONE policy instead of one per vendor — and that only holds if the
 * three networked adapters classify the same status the same way. Hence the
 * table below, replayed against all three.
 *
 * `internal` IS THE FAILURE MODE THIS FILE EXISTS TO CATCH. Section 0.1 says
 * in so many words that it is never used to avoid classifying, so no case here
 * may produce it — including the ones the table does not name.
 *
 * REPORTED: the acceptance criterion says "pour chaque adaptateur", and `stub`
 * is one of the four. It opens no socket, by definition, so there is no
 * status for it to classify. What is asserted of it instead is the property
 * that matters: what it throws is a `NarratorError`, and never `internal`.
 */

import { NarratorError, type NarratorErrorCode, type NarratorPort } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { createAnthropicNarrator } from '../src/narrator/adapters/anthropic.js';
import { createOllamaNarrator } from '../src/narrator/adapters/ollama.js';
import { createOpenAiCompatibleNarrator } from '../src/narrator/adapters/openai-compatible.js';
import { createStubNarrator } from '../src/narrator/adapters/stub.js';
import type { NarratorFetch } from '../src/narrator/http.js';
import { TOOL_DEFINITIONS } from '../src/tools/definitions.js';
import { collect, configFor, scriptedFetch } from './support.js';

const request = {
  purpose: 'narration' as const,
  requestId: 'nar_err',
  system: [{ type: 'text' as const, text: 's' }],
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'u' }] }],
  tools: TOOL_DEFINITIONS,
  toolPolicy: 'auto' as const,
  maxOutputTokens: 800,
  effort: 'low' as const,
};

/**
 * The five statuses of the criterion, written in full letters against the five
 * codes of the criterion. Neither side is read from `src/`.
 */
const TABLE: readonly { readonly status: number; readonly code: NarratorErrorCode }[] = [
  { status: 401, code: 'unauthenticated' },
  { status: 429, code: 'rate_limited' },
  { status: 404, code: 'model_not_found' },
  { status: 400, code: 'bad_request' },
  { status: 500, code: 'unavailable' },
  { status: 503, code: 'unavailable' },
  { status: 403, code: 'unauthorized' },
  { status: 402, code: 'quota_exhausted' },
];

const NETWORKED: readonly {
  readonly name: string;
  build(fetchImpl: NarratorFetch): NarratorPort;
}[] = [
  {
    name: 'anthropic',
    build: (fetchImpl) => createAnthropicNarrator(configFor('anthropic'), { fetch: fetchImpl }),
  },
  {
    name: 'openai-compatible',
    build: (fetchImpl) =>
      createOpenAiCompatibleNarrator(configFor('openai-compatible'), { fetch: fetchImpl }),
  },
  {
    name: 'ollama',
    build: (fetchImpl) => createOllamaNarrator(configFor('ollama'), { fetch: fetchImpl }),
  },
];

const caught = async (port: NarratorPort): Promise<NarratorError> => {
  try {
    await collect(port.narrer(request));
  } catch (error) {
    if (error instanceof NarratorError) return error;
    throw new Error(`ce n'est pas un NarratorError : ${String(error)}`);
  }
  throw new Error('aucune erreur levée');
};

describe.each(NETWORKED)('le classement des erreurs, adaptateur $name', (adapter) => {
  it.each(TABLE)('un $status devient $code', async ({ status, code }) => {
    const port = adapter.build(scriptedFetch(() => new Response('{"error":{}}', { status })));
    const error = await caught(port);
    expect(error.code).toBe(code);
    expect(error.code).not.toBe('internal');
    expect(error.providerId).toBe(adapter.name);
  });

  it('un 429 avec Retry-After: 3 donne retryAfterMs === 3000', async () => {
    const port = adapter.build(
      scriptedFetch(() => new Response('{}', { status: 429, headers: { 'retry-after': '3' } })),
    );
    const error = await caught(port);
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterMs).toBe(3000);
    expect(error.retryable).toBe(true);
  });

  it("un 400 qui nomme la fenêtre de contexte n'est pas un bogue de notre côté", async () => {
    const port = adapter.build(
      scriptedFetch(
        () =>
          new Response('{"error":{"message":"maximum context length exceeded"}}', { status: 400 }),
      ),
    );
    expect((await caught(port)).code).toBe('context_too_large');
  });

  it("une panne de transport ne laisse pas fuir l'exception d'origine", async () => {
    const port = adapter.build(() => Promise.reject(new TypeError('socket hang up')));
    const error = await caught(port);
    expect(error).toBeInstanceOf(NarratorError);
    expect(error.code).not.toBe('internal');
  });

  it('aucun des statuts testés ne produit internal', async () => {
    for (const status of [400, 401, 402, 403, 404, 408, 409, 418, 429, 500, 502, 503, 529]) {
      const port = adapter.build(scriptedFetch(() => new Response('{}', { status })));
      expect((await caught(port)).code).not.toBe('internal');
    }
  });
});

describe('le stub, qui ne classe aucun statut parce qu’il n’en reçoit aucun', () => {
  it('refuse structurer() avec unsupported, jamais internal', async () => {
    const port = createStubNarrator(configFor('stub'));
    await expect(
      port.structurer({
        purpose: 'forge',
        requestId: 'r',
        system: [],
        messages: [],
        schema: { safeParse: () => ({ success: true, data: null }) } as never,
        schemaName: 'x',
        maxOutputTokens: 10,
        effort: 'low',
      }),
    ).rejects.toMatchObject({ code: 'unsupported', providerId: 'stub' });
  });
});
