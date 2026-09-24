/**
 * The WebSocket envelope — `{ v, t, id, ts?, seq?, deliverySeq?, p }`
 * (01-architecture.md section 5.1, ADR 0010 decision 1).
 *
 * TWO ENVELOPES EXIST IN THIS REPOSITORY AND THEY ARE NOT THE SAME THING.
 * This one wraps a WIRE FRAME. `events/envelope.ts` wraps a JOURNAL ENTRY and
 * carries `correlationId`, `scope`, `recipients`. A journal envelope travels
 * INSIDE `p.event` of an `s2c.event` frame; it never merges with this one.
 *
 * THREE COUNTERS, THREE ORIGINS, NEVER TO BE CONFUSED:
 *
 *   - `seq` — the campaign's journal number. On `s2c.event` only. Global, and
 *     since ADR 0008 NOT dense for a given recipient: an addressed event a
 *     player does not receive leaves a legitimate hole in what that player
 *     sees. It is the game's clock, not a delivery cursor.
 *   - `deliverySeq` — ADR 0010 decision 1. Dense per (campaign, player),
 *     minted by the server on delivery, NOT stored in the journal. This is the
 *     only counter a client may use to detect a loss, because it is the only
 *     one with no legitimate holes.
 *   - `chunk` — the fragment number of a narration stream. Lives in a
 *     narration PAYLOAD, never in this envelope.
 *
 * WHY THE DISTINCTION IS LOAD-BEARING. `ARCHITECTURE.md` section 6 step 5 still
 * promises `s2c.event` "dans l'ordre strict des seq, sans trou". With addressed
 * broadcast that sentence cannot be true of `seq`, and a client that watched
 * `seq` for gaps could no longer tell "not for me" from "lost". ADR 0010 moves
 * the guarantee onto `deliverySeq`. Reported, not corrected here: a design
 * document is not this task's to edit.
 *
 * `zC2SEnvelope` and `zS2CEnvelope` are NOT declared in this file, although
 * 01-architecture.md section 2.4 sketches them here. They are the unions of
 * the frames, so they live with the frames in `c2s.ts` and `s2c.ts`; declaring
 * them here would make this module import its own importers. Divergence
 * reported rather than worked around with a cycle.
 */

import { z } from 'zod';

import { zEpochMillis, zSeq } from '../primitives.js';
import { PROTOCOL_VERSION } from '../version.js';

/** `v`. A mismatch closes the socket with 4001, before anything else. */
export const zProtocolVersion = z.literal(PROTOCOL_VERSION);

/**
 * `id`. UUID v7 minted by the sender. On a c2s frame it is the IDEMPOTENCE
 * KEY: replaying the same `id` returns the same result without re-running
 * `decide()` (section 5.1). The shape cannot check v7-ness, and must not
 * pretend to: uniqueness is enforced by the `intents` table.
 */
export const zMessageId = z.uuid();

/** ADR 0010: dense per (campaign, player), first delivery is 1. */
export const zDeliverySeq = z.number().int().positive();

/** A cursor into the delivery numbering. 0 means "I have received nothing". */
export const zDeliveryCursor = z.number().int().nonnegative();

/** A journal cursor. 0 means "empty campaign". */
export const zJournalCursor = z.number().int().nonnegative();

/**
 * Narration stream identifier, derived server-side from the `eventSeq` that
 * opens the turn — which is what makes generation idempotent
 * (02-mj-ia.md section 6.2). Opaque to the client.
 */
export const zNarrationId = z.string().min(1).max(64);

/** Fragment number within one narration stream. `narration_started` is 0. */
export const zChunk = z.number().int().nonnegative();

/**
 * The cheapest possible pre-parse, used before full validation so that a frame
 * from the wrong protocol version is answered with 4001 rather than with a
 * pile of union errors. Deliberately NOT strict: it looks at two fields and
 * says nothing about the rest.
 */
export const zEnvelopeHead = z.object({
  v: z.number().int(),
  t: z.string().min(1),
});

/**
 * A client frame. No `ts`: a client clock is not evidence, and the server
 * stamps what it accepts (invariant 3). No `seq` and no `deliverySeq` either —
 * a client never asserts a position, it asks for one through `c2s.resume`.
 *
 * `strictObject`: an unknown top-level key is REFUSED, not dropped. On a
 * frozen protocol, silently ignoring a field is how a second write path gets
 * built by accident.
 */
/**
 * THE THREE RETURN TYPES ARE WRITTEN INLINE, and that is not laziness.
 *
 * Two repository rules meet here and pull opposite ways: `z.ZodObject` needs a
 * shape with an implicit index signature, which an `interface` does NOT have
 * (« Index signature for type 'string' is missing », measured), while the lint
 * rule `consistent-type-definitions` refuses a named object `type`. An inline
 * type literal satisfies both. Reported here so the next reader does not spend
 * the same twenty minutes discovering it.
 */

export function c2sFrame<TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
): z.ZodObject<
  {
    v: typeof zProtocolVersion;
    t: z.ZodLiteral<TType>;
    id: typeof zMessageId;
    p: TPayload;
  },
  z.core.$strict
> {
  return z.strictObject({
    v: zProtocolVersion,
    t: z.literal(type),
    id: zMessageId,
    p: payload,
  });
}

/** A server frame. Stamped, unnumbered — see `s2cEventFrame` for the one that is. */
export function s2cFrame<TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
): z.ZodObject<
  {
    v: typeof zProtocolVersion;
    t: z.ZodLiteral<TType>;
    id: typeof zMessageId;
    ts: typeof zEpochMillis;
    p: TPayload;
  },
  z.core.$strict
> {
  return z.strictObject({
    v: zProtocolVersion,
    t: z.literal(type),
    id: zMessageId,
    ts: zEpochMillis,
    p: payload,
  });
}

/**
 * The only numbered frame. `seq` says where the fact sits in the journal;
 * `deliverySeq` says where this delivery sits in THIS player's stream. Both,
 * or the client loses the ability to tell a silence from a loss.
 */
export function s2cEventFrame<TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
): z.ZodObject<
  {
    v: typeof zProtocolVersion;
    t: z.ZodLiteral<TType>;
    id: typeof zMessageId;
    ts: typeof zEpochMillis;
    seq: typeof zSeq;
    deliverySeq: typeof zDeliverySeq;
    p: TPayload;
  },
  z.core.$strict
> {
  return z.strictObject({
    v: zProtocolVersion,
    t: z.literal(type),
    id: zMessageId,
    ts: zEpochMillis,
    seq: zSeq,
    deliverySeq: zDeliverySeq,
    p: payload,
  });
}
