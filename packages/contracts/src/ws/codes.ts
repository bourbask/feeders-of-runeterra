/**
 * The numbers and limits of the wire (01-architecture.md sections 5, 5.5, 5.6).
 *
 * A close code is not decoration: it is the only thing a client gets when the
 * socket dies during the handshake, before any `s2c.*` could be sent. So the
 * name of every close reason is ALSO an `AppErrorCode` — one vocabulary, two
 * transports — and `satisfies Partial<Record<AppErrorCode, number>>` below
 * makes a reason that is not in that vocabulary a compilation error.
 *
 * THE HOLE AT 4005-4007 IS DELIBERATE. Section 5.5 assigns 4001-4004 and
 * 4008-4011 and leaves the middle unused. Closing the gap would renumber codes
 * a deployed client already reads, which is the one thing a frozen protocol
 * may not do.
 */

import { z } from 'zod';

import { zRuleViolationCode } from '../core/enums.js';
import type { AppErrorCode } from '../errors.js';
import { zAppErrorCode } from '../errors.js';

export const WS_CLOSE_CODES = {
  protocol_version: 4001,
  unauthenticated: 4002,
  forbidden_campaign: 4003,
  campaign_not_found: 4004,
  rate_limited: 4008,
  payload_too_large: 4009,
  server_shutdown: 4010,
  campaign_rebuilding: 4011,
} as const satisfies Partial<Record<AppErrorCode, number>>;

/** The reason a socket was closed, by name. */
export type WsCloseReason = keyof typeof WS_CLOSE_CODES;
/** The number actually put on the wire. */
export type WsCloseCode = (typeof WS_CLOSE_CODES)[WsCloseReason];

export const WS_CLOSE_REASONS = Object.keys(WS_CLOSE_CODES) as readonly WsCloseReason[];

/**
 * What `s2c.error` carries. Same closed union as the HTTP surface: a client
 * reacts to a code, never to a message string (01-architecture.md section 3.3).
 */
export const zWsErrorCode = zAppErrorCode;

/**
 * What `s2c.rejected` carries. TWO FAMILIES, NEVER FUSED: the rules refused
 * the intent (`RuleViolationCode`, the engine's word), or the request could
 * not be served at all (`AppErrorCode`, the server's). A player needs to know
 * which, because only the first is part of the fiction.
 */
export const zRejectionCode = z.union([zRuleViolationCode, zAppErrorCode]);
export type RejectionCode = z.output<typeof zRejectionCode>;

/** Section 5: JSON UTF-8, 64 KiB in, 256 KiB out. Exceeding in = close 4009. */
export const WS_MAX_INCOMING_FRAME_BYTES = 64 * 1024;
export const WS_MAX_OUTGOING_FRAME_BYTES = 256 * 1024;

/** Section 5: server `ping` every 25 s, close if no `pong` within 60 s. */
export const WS_HEARTBEAT_INTERVAL_MS = 25_000;
export const WS_HEARTBEAT_TIMEOUT_MS = 60_000;

/** Section 5.6: the third overrun closes with 4008 instead of erroring again. */
export const WS_RATE_LIMIT_STRIKES_BEFORE_CLOSE = 3;

/** 02-mj-ia.md section 6.3: past this the server collapses the socket queue. */
export const WS_SOCKET_QUEUE_MAX_MESSAGES = 64;
