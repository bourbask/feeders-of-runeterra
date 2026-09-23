/**
 * `AppErrorCode` — the server's closed error vocabulary, shared with the
 * client so it can react by code rather than by string matching
 * (01-architecture.md section 3.3).
 *
 * THREE FAMILIES, NEVER MIXED:
 *
 *   1. `RuleViolation` (engine). An intent the RULES refuse. Closed union
 *      `RuleViolationCode`, mirrored in `core/violations.ts`. Never an
 *      exception: `decide()` returns it.
 *   2. `AppError` (server). What this file types. Carries an HTTP status and a
 *      French `userMessage` that the client may show; `details` stays in the
 *      log and is never serialised to the client in production.
 *   3. Unexpected. Logged with its stack, answered as `internal_error`.
 *
 * WHERE THIS LIST COMES FROM, and what is mine. 01-architecture.md section 3.3
 * declares the union closed but enumerates only `ai_unavailable`,
 * `ai_invalid_output` and `internal_error`. The rest closes the ellipsis from
 * the vocabulary the same document already fixes elsewhere: the WebSocket
 * close codes of section 5.5 (`protocol_version`, `unauthenticated`,
 * `forbidden_campaign`, `campaign_not_found`, `rate_limited`,
 * `payload_too_large`, `server_shutdown`, `campaign_rebuilding`) and the HTTP
 * surface of section 6. It is reported as an addition, exactly as M0-02
 * reported closing `RuleViolationCode`.
 *
 * NO ERROR CODE IS A RULE OUTCOME. `gauge_out_of_range` belongs to
 * `RuleViolationCode`, not here: an `AppError` says the request could not be
 * served, never what happened in the fiction.
 */

import { z } from 'zod';

import { zCorrelationId } from './primitives.js';

export const APP_ERROR_CODES = [
  // Protocol and transport (01-architecture.md section 5.5).
  'protocol_version',
  'payload_too_large',
  'rate_limited',
  'server_shutdown',
  'campaign_rebuilding',
  // Identity and access (section 6).
  'unauthenticated',
  'forbidden_campaign',
  'csrf_failed',
  // Resources.
  'campaign_not_found',
  'character_not_found',
  'content_not_found',
  'route_not_found',
  // Input.
  'validation_failed',
  'conflict',
  // The storyteller. Neither of these ever stops a game event from being
  // persisted: narration degrades, the game does not (invariant 1).
  'ai_unavailable',
  'ai_invalid_output',
  // Everything else.
  'internal_error',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export const zAppErrorCode = z.enum(APP_ERROR_CODES);

/**
 * What actually reaches the client. `details` is deliberately absent: it stays
 * in the log (01-architecture.md section 3.3).
 */
export const zAppErrorPayload = z.object({
  code: zAppErrorCode,
  /** French, showable to a player. */
  message: z.string().min(1),
  requestId: z.string().min(1),
  /** Present when the error answers a specific client intent. */
  intentId: zCorrelationId.optional(),
});

export type AppErrorPayload = z.output<typeof zAppErrorPayload>;
