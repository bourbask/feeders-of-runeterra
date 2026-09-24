/**
 * `zC2SMessage` — the EIGHT frames a client may send (01-architecture.md
 * section 5.2). This file is where invariant 3 stops being a promise.
 *
 * NOT ONE OF THESE CARRIES A RESULT. No gauge, no die, no outcome, no
 * `GameEvent`, no `CampaignState`, no journal position asserted by the client.
 * Read the eight as questions; not one of them is an answer. Only `c2s.intent`
 * mutates anything, and what it carries is an `Intent` — a request, resolved
 * by `decide()` on the server (ARCHITECTURE.md section 6).
 *
 * `c2s.resume`, `c2s.resume_narration` and `c2s.why` are READS. That is why
 * they are compatible with invariant 3 despite not being intents: they ask the
 * server to repeat itself, never to decide anything.
 *
 * THE GUARD IS A RUNTIME TEST, NOT THIS COMMENT. `tests/ws-protocol.test.ts`
 * walks the whole schema graph below — through `zIntent`, not stopping at it —
 * and compares the set of key names it finds against a frozen list. A `gauge`
 * added anywhere under any of the eight turns that test red. ADR 0007's lesson
 * applies here exactly as it does to the event mirror: a deny-list of the
 * fields we thought of is not a guard; the frozen enumeration is.
 *
 * TWO DIVERGENCES FROM SECTION 5.2, both reported rather than papered over:
 *
 *   1. `c2s.speak` carries `channel: 'ic' | 'ooc'`, not `'rp' | 'ooc'`. The
 *      message BECOMES an `Intent` `speech.say` server-side, and the engine —
 *      canonical by the mirror rule — spells that channel `'ic' | 'ooc'`. So
 *      the two fields are not merely equal here, they are the SAME schema
 *      node, taken from `zSpeechSayIntent.shape`: the wire and the intent it
 *      turns into cannot drift apart.
 *   2. `c2s.hello` carries `lastDeliverySeq`, and `c2s.resume` carries
 *      `sinceDeliverySeq`, where section 5.2 writes `lastSeq` and `sinceSeq`.
 *      ADR 0010 decision 1 changes the resume cursor explicitly; it names only
 *      `c2s.resume`, but `c2s.hello` triggers the same catch-up and would be
 *      unusable with a cursor that has legitimate holes. FORCED BY THE
 *      DECISION, BEYOND ITS LETTER — and stated here so the next reader does
 *      not have to rediscover why.
 *
 * There is NO global `seq` anywhere in this file, on purpose, and
 * `tests/ws-protocol.test.ts` asserts that absence: a client offered both
 * cursors would eventually watch the wrong one, and confusing "not for me"
 * with "lost" is the failure ADR 0010 exists to prevent.
 */

import { z } from 'zod';

import { zIntent, zSpeechSayIntent } from '../intents/index.js';
import { zCorrelationId } from '../primitives.js';
import { c2sFrame, zChunk, zDeliveryCursor, zDeliverySeq, zNarrationId } from './envelope.js';

/**
 * Opens the session. The server answers `s2c.welcome`, then either a catch-up
 * or a snapshot depending on how far behind `lastDeliverySeq` is. `null` means
 * "I have never received anything from this table".
 */
export const zC2SHello = c2sFrame(
  'c2s.hello',
  z.strictObject({
    clientVersion: z.string().min(1).max(64),
    lastDeliverySeq: zDeliverySeq.nullable(),
  }),
);

/** THE ONLY MUTATING FRAME. What it carries is a question (section 5.3). */
export const zC2SIntent = c2sFrame('c2s.intent', z.strictObject({ intent: zIntent }));

/**
 * Speech. The two fields ARE the fields of `speech.say`, by reference: this
 * frame is converted into that intent server-side, and a copy would be a place
 * for the two to diverge.
 */
export const zC2SSpeak = c2sFrame(
  'c2s.speak',
  z.strictObject({
    channel: zSpeechSayIntent.shape.channel,
    text: zSpeechSayIntent.shape.text,
  }),
);

/** Ephemeral, never journalled. Sampled at 1/s client-side (section 5.6). */
export const zC2STyping = c2sFrame('c2s.typing', z.strictObject({ typing: z.boolean() }));

/**
 * "Send me what I missed." READ, not a mutation.
 *
 * The cursor is the player's DELIVERY number (ADR 0010), never the journal
 * `seq`: only the delivery numbering is dense for this player, so only it can
 * distinguish a hole caused by loss from a hole caused by an event that was
 * addressed to someone else. `0` asks for everything.
 */
export const zC2SResume = c2sFrame(
  'c2s.resume',
  z.strictObject({ sinceDeliverySeq: zDeliveryCursor }),
);

/** Answer to the heartbeat. Carries nothing, by construction. */
export const zC2SPong = c2sFrame('c2s.pong', z.strictObject({}));

/**
 * Re-asks for the missing fragments of the narration in flight. NEVER
 * triggers a second generation: the server replays its buffer
 * (02-mj-ia.md section 6.3).
 */
export const zC2SResumeNarration = c2sFrame(
  'c2s.resume_narration',
  z.strictObject({ narrationId: zNarrationId, lastChunk: zChunk }),
);

/**
 * « Pourquoi ? » — asks for the proof of one turn (P22).
 *
 * ONE FIELD, AND ONLY ONE. The client names the turn; it does not say what it
 * expects to find in it. A `seq`, an `outcome` or an `event` added here would
 * be a client asserting a result, and `tests/ws-protocol.test.ts` refuses it
 * exactly as it would on any other `c2s.*`. The answer is `s2c.turn_proof`, a
 * projection of the journal built on the server.
 */
export const zC2SWhy = c2sFrame('c2s.why', z.strictObject({ correlationId: zCorrelationId }));

export const zC2SMessage = z.discriminatedUnion('t', [
  zC2SHello,
  zC2SIntent,
  zC2SSpeak,
  zC2STyping,
  zC2SResume,
  zC2SPong,
  zC2SResumeNarration,
  zC2SWhy,
]);

/**
 * The same schema under the name section 2.4 uses. ONE parse path, two names:
 * a second schema would be a second place for a frame to be accepted, and the
 * whole point of section 5 is that every incoming frame goes through one.
 */
export const zC2SEnvelope = zC2SMessage;

export type C2SMessage = z.output<typeof zC2SMessage>;
export type C2SMessageType = C2SMessage['t'];

/** Derived, never hand-written — same reason as `gameEventTypesOfSchema`. */
export function c2sMessageTypesOfSchema(): readonly string[] {
  return zC2SMessage.options.map((option) => option.shape.t.value);
}

/** One rate-limit bucket: `count` frames per `windowMs`, tolerating `burst`. */
export interface WsRateLimit {
  readonly count: number;
  readonly windowMs: number;
  readonly burst?: number;
}

/**
 * Section 5.6, per connection. `satisfies Partial<Record<C2SMessageType, …>>`
 * is the point of putting the table here rather than in `codes.ts`: a bucket
 * naming a frame that does not exist is a compilation error.
 *
 * `c2s.why` gets 10/10 s deliberately — unfolding « Pourquoi ? » on several
 * scenes in a row is normal use; looping on it is not. The frames with no
 * bucket (`c2s.hello`, `c2s.pong`, `c2s.resume_narration`) are bounded by the
 * handshake and the heartbeat instead.
 */
export const WS_RATE_LIMITS = {
  'c2s.intent': { count: 5, windowMs: 10_000, burst: 10 },
  'c2s.speak': { count: 20, windowMs: 60_000 },
  'c2s.resume': { count: 2, windowMs: 10_000 },
  'c2s.why': { count: 10, windowMs: 10_000 },
  'c2s.typing': { count: 1, windowMs: 1_000 },
} as const satisfies Partial<Record<C2SMessageType, WsRateLimit>>;
