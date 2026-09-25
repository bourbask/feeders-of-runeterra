/**
 * The little that the three networked adapters share: how a transport is
 * injected, how a byte stream becomes frames, and how an HTTP status becomes
 * a `NarratorErrorCode`.
 *
 * ── WHY THE TRANSPORT IS A PARAMETER ────────────────────────────────────────
 * `packages/ai/tests/setup.ts` makes any real egress fail the test run, which
 * is the only way to be sure a bounding PR test never calls a provider. An
 * adapter that reached for the ambient `fetch` could not be exercised at all;
 * one that takes it as a parameter is exercised against a simulated transport,
 * which is exactly what the port contract test does against all four.
 *
 * ── WHY STATUS CLASSIFICATION LIVES HERE AND NOT IN EACH ADAPTER ────────────
 * Section 7.1's retry policy is written against `NarratorErrorCode`, so there
 * is ONE policy instead of one per vendor. Three copies of the mapping would
 * be three chances for one of them to answer `internal` — the code section 0.1
 * says is never used to avoid classifying.
 */

import { NarratorError, type NarratorErrorCode, type NarratorProviderId } from '@for/contracts';

/** The shape of `fetch`, narrowed to what the adapters use. */
export type NarratorFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Section 0.6: `NARRATOR_TIMEOUT_MS`, same default for the four adapters. */
export const NARRATOR_TIMEOUT_MS_DEFAULT = 60_000;

/** Milliseconds asked for by `Retry-After`, when the provider gives a number of seconds. */
export function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) return null;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

/** A 400 that names the context window is not a bug of ours — it is section 4.4's overflow. */
const CONTEXT_PATTERNS = /context[_ ]?(length|window)|too many tokens|maximum context/i;
const CREDIT_PATTERNS = /insufficient[_ ]?(credit|quota|funds)|billing|payment required/i;

/**
 * HTTP status → port code, per sections 0.3 and 0.4.
 *
 * The two tables of the spec agree everywhere they overlap, which is why one
 * function serves the three adapters. `internal` is NOT reachable from here:
 * every branch names a cause.
 */
export function classifyStatus(status: number, body: string): NarratorErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'unauthorized';
  if (status === 402) return 'quota_exhausted';
  if (status === 404) return 'model_not_found';
  if (status === 429) return 'rate_limited';
  if (status === 408) return 'timeout';
  if (status === 400) {
    if (CONTEXT_PATTERNS.test(body)) return 'context_too_large';
    if (CREDIT_PATTERNS.test(body)) return 'quota_exhausted';
    return 'bad_request';
  }
  if (status >= 500) return 'unavailable';
  if (CREDIT_PATTERNS.test(body)) return 'quota_exhausted';
  return 'unavailable';
}

/** Build the one error type allowed out of an adapter from a non-OK response. */
export async function errorFromResponse(
  response: Response,
  providerId: NarratorProviderId,
): Promise<NarratorError> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  return new NarratorError({
    code: classifyStatus(response.status, body),
    providerId,
    message: `${providerId}: HTTP ${String(response.status)}`,
    retryAfterMs: retryAfterMs(response.headers),
    providerDetail: body.length === 0 ? null : body.slice(0, 2000),
  });
}

/**
 * Anything an adapter throws that is not already a `NarratorError` — an
 * `AbortError`, a DNS failure, a parser throw — becomes one here. Contract 3
 * of section 0.1: no SDK exception, no `fetch` rejection and no parser throw
 * crosses the port.
 */
export function wrapUnknown(cause: unknown, providerId: NarratorProviderId): NarratorError {
  if (cause instanceof NarratorError) return cause;
  const name = cause instanceof Error ? cause.name : '';
  const code: NarratorErrorCode =
    name === 'AbortError' ? 'aborted' : name === 'TimeoutError' ? 'timeout' : 'unavailable';
  return new NarratorError({
    code,
    providerId,
    message: cause instanceof Error ? cause.message : 'transport failure',
    providerDetail: null,
    cause,
  });
}

// --------------------------------------------------------------- framing

async function* readLines(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (body === null) return;
  const decoder = new TextDecoder();
  let buffer = '';
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  try {
    for (;;) {
      const chunk = (await reader.read()) as { done: boolean; value: Uint8Array | undefined };
      if (chunk.done || chunk.value === undefined) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let cut = buffer.indexOf('\n');
      while (cut !== -1) {
        yield buffer.slice(0, cut).replace(/\r$/, '');
        buffer = buffer.slice(cut + 1);
        cut = buffer.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (buffer.length > 0) yield buffer.replace(/\r$/, '');
}

/** One decoded JSON object per NDJSON line. Blank lines are skipped. */
export async function* readNdjson(response: Response): AsyncGenerator {
  for await (const line of readLines(response)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    yield JSON.parse(trimmed) as unknown;
  }
}

/**
 * One decoded JSON object per SSE `data:` line, `[DONE]` excluded.
 *
 * `event:` lines are carried alongside, because one of the two wire formats
 * puts the frame type there and the other puts it inside the payload.
 */
export async function* readSse(
  response: Response,
): AsyncGenerator<{ readonly event: string | null; readonly data: unknown }> {
  let event: string | null = null;
  for await (const line of readLines(response)) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith('data:')) {
      if (line.trim().length === 0) event = null;
      continue;
    }
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      event = null;
      continue;
    }
    yield { event, data: JSON.parse(payload) as unknown };
    event = null;
  }
}
