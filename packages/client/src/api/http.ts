/**
 * The HTTP client: one `fetch` wrapper, and every answer validated by the
 * schema the server declares (01-architecture.md section 6).
 *
 * THREE RULES THIS FILE EXISTS TO HOLD:
 *
 *   1. NOTHING IS TRUSTED ON ARRIVAL. Every response goes through
 *      `schema.safeParse`. A body that does not match is an `HttpError`, not a
 *      shape the screens then have to guess about.
 *   2. `credentials: 'include'`, NO TOKEN. The session is the `fr_session`
 *      cookie; the browser attaches it. The client never reads it and never
 *      holds one.
 *   3. EVERY MUTATION CARRIES THE CSRF HEADER, and the name and value come
 *      from `@for/contracts`, not from a string typed here — two spellings of
 *      one header is how a mutation starts failing in production only.
 */

import type { AppErrorCode } from '@for/contracts';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE, zAppErrorPayload } from '@for/contracts';
import type { z } from 'zod';

import { appErrorMessage } from './error-messages.js';

/**
 * A failed request, already carrying the sentence a screen may show. The code
 * is what the caller branches on; the message is what the player reads.
 */
export class HttpError extends Error {
  readonly code: AppErrorCode | 'invalid_response' | 'network_error';
  readonly status: number;

  constructor(
    code: AppErrorCode | 'invalid_response' | 'network_error',
    status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = status;
  }
}

export const UNREADABLE_RESPONSE_MESSAGE = 'Le serveur a répondu quelque chose d’illisible.';
export const NETWORK_ERROR_MESSAGE = 'Le serveur est injoignable.';

export interface HttpDeps {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
}

export interface RequestOptions<TSchema extends z.ZodType> {
  readonly method?: 'GET' | 'POST';
  readonly path: string;
  readonly schema: TSchema;
  readonly body?: unknown;
}

/** A parsed body, or an `HttpError`. Never a half-validated object. */
export async function request<TSchema extends z.ZodType>(
  deps: HttpDeps,
  options: RequestOptions<TSchema>,
): Promise<z.output<TSchema>> {
  const method = options.method ?? 'GET';
  const isMutation = method !== 'GET';

  let response: Response;
  try {
    response = await deps.fetch(`${deps.baseUrl}${options.path}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(isMutation ? { [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new HttpError('network_error', 0, NETWORK_ERROR_MESSAGE);
  }

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const error = zAppErrorPayload.safeParse(payload);
    if (error.success) {
      throw new HttpError(error.data.code, response.status, appErrorMessage(error.data.code));
    }
    throw new HttpError('invalid_response', response.status, UNREADABLE_RESPONSE_MESSAGE);
  }

  const parsed = options.schema.safeParse(payload);
  if (!parsed.success) {
    throw new HttpError('invalid_response', response.status, UNREADABLE_RESPONSE_MESSAGE);
  }
  return parsed.data;
}
