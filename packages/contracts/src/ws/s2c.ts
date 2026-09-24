/**
 * `zS2CMessage` — the FIFTEEN frames a server may send (01-architecture.md
 * section 5.4).
 *
 * `s2c.event` IS THE ONLY VECTOR OF STATE MUTATION. Everything else is
 * presentation, catch-up or diagnosis: a client that applied a gauge change
 * read from `s2c.narration_done` would be inventing state. And `s2c.event` is
 * the only frame that carries numbers in its envelope, which is how that
 * uniqueness is visible from the wire alone.
 *
 * ADDRESSED BROADCAST (ADR 0008). The server decides who receives what; the
 * client filters NOTHING. There is therefore no `scope` and no `recipients`
 * field anywhere in this file: those live on the JOURNAL envelope inside
 * `p.event`, where the server wrote them, and a client that received a frame
 * has already been judged entitled to it. A client-side filter is not
 * confidentiality, it is a suggestion.
 *
 * THE DELIVERY NUMBER (ADR 0010 decision 1). `s2c.event` carries `seq` AND
 * `deliverySeq`; `s2c.events_batch` carries both per entry; `s2c.welcome` and
 * `s2c.snapshot` carry both cursors. The second of each pair is what makes
 * "no gaps" true again for one player — see `ws/envelope.ts`. Carrying both
 * cursors on `welcome` and `snapshot` goes beyond the letter of ADR 0010 and
 * is forced by it: after a snapshot the client must know where its own dense
 * stream resumes, and `lastSeq` alone cannot tell it.
 */

import { z } from 'zod';

import { zTableState } from '../dto/table-state.js';
import { zTurnProof } from '../dto/turn-proof.js';
import { zAppErrorPayload } from '../errors.js';
import { zGameEvent } from '../events/index.js';
import { zNarrationGmMessagePayload } from '../events/narrative.js';
import { zCampaignId, zCharacterId, zCorrelationId, zPlayerId, zSeq } from '../primitives.js';
import { WS_MAX_OUTGOING_FRAME_BYTES, zRejectionCode } from './codes.js';
import {
  s2cEventFrame,
  s2cFrame,
  zChunk,
  zDeliveryCursor,
  zDeliverySeq,
  zJournalCursor,
  zMessageId,
  zNarrationId,
  zProtocolVersion,
} from './envelope.js';

/**
 * How a narration stream stands when a client asks about it (02-mj-ia.md
 * section 6.3). PROTOCOL-ONLY: the engine knows nothing about streams, so
 * there is no mirror to keep and none to compare. Said explicitly, per the
 * operating rule of ADR 0007: a constant that is not a copy has no mirror; a
 * constant that IS a copy must be compared at runtime.
 */
export const zNarrationStatus = z.enum(['streaming', 'done', 'failed', 'aborted']);

/**
 * Why a narration ended badly, ON THE WIRE. `action_impossible` is the
 * storyteller's RIGHT OF REFUSAL (02-mj-ia.md section 4.8) and is emitted
 * AFTER `s2c.narration_done`, because the prose is valid and must be shown;
 * the `system.reverted` event that follows MARKS the turn's lines as cancelled
 * and does not remove them.
 *
 * NOT THE SAME LIST as `narration.gm_failed.errorKind` in the journal, and not
 * a drifted copy of it either: the journal records what broke inside the
 * server (`api_error`, `invalid_output`, `rejected_by_postfilter`), the wire
 * says what the player's screen should do. Two audiences, two vocabularies —
 * 01-architecture.md section 5.4 fixes this one.
 */
export const zNarrationErrorCode = z.enum([
  'rate_limited',
  'refused',
  'engine_fallback',
  'aborted',
  'action_impossible',
]);

/**
 * Text produced by the model, or by the engine's deterministic fallback. NOT
 * retyped: this IS the journal's node, so the frame and the
 * `narration.gm_message` it announces cannot say different things.
 */
export const zNarrationSource = zNarrationGmMessagePayload.shape.source;

// -------------------------------------------------------------- the session

export const zS2CWelcome = s2cFrame(
  's2c.welcome',
  z.strictObject({
    protocolVersion: zProtocolVersion,
    playerId: zPlayerId,
    campaignId: zCampaignId,
    you: z.strictObject({ characterId: zCharacterId.nullable() }),
    contentVersion: z.string().min(1),
    /** Head of the campaign journal. Informational: the table's clock. */
    lastSeq: zJournalCursor,
    /** Head of THIS player's dense delivery stream. The resume cursor. */
    lastDeliverySeq: zDeliveryCursor,
  }),
);

/**
 * Sent when the client's cursor is too old or absent. `state` is a projection
 * PER SPECTATOR (`zTableState`), never the raw `CampaignState`.
 */
export const zS2CSnapshot = s2cFrame(
  's2c.snapshot',
  z.strictObject({
    state: zTableState,
    lastSeq: zJournalCursor,
    lastDeliverySeq: zDeliveryCursor,
  }),
);

// ---------------------------------------------------------------- the facts

/** THE ONLY VECTOR OF STATE MUTATION. Numbers live in the envelope. */
export const zS2CEvent = s2cEventFrame('s2c.event', z.strictObject({ event: zGameEvent }));

/**
 * Catch-up after `c2s.resume`. Each entry carries BOTH numbers, for the same
 * reason `s2c.event` does: the client resumes on `deliverySeq` and reads the
 * journal by `seq`. No `.max()`: the bound that matters is the 256 KiB
 * outgoing frame, which the server enforces by splitting, not the schema.
 */
export const zS2CEventsBatch = s2cFrame(
  's2c.events_batch',
  z.strictObject({
    events: z.array(z.strictObject({ seq: zSeq, deliverySeq: zDeliverySeq, event: zGameEvent })),
  }),
);

// ------------------------------------------------------------ the narration

export const zS2CNarrationStarted = s2cFrame(
  's2c.narration_started',
  z.strictObject({
    narrationId: zNarrationId,
    eventSeq: zSeq,
    actorCharacterId: zCharacterId.nullable(),
    /** Literally 0: the stream opens here, and section 5.4 pins the value. */
    chunk: z.literal(0),
  }),
);

/** Fragments coalesced into 50 ms windows. */
export const zS2CNarrationDelta = s2cFrame(
  's2c.narration_delta',
  z.strictObject({ narrationId: zNarrationId, chunk: zChunk, text: z.string() }),
);

/** The whole buffer: for a client arriving mid-generation, or catching up. */
export const zS2CNarrationSnapshot = s2cFrame(
  's2c.narration_snapshot',
  z.strictObject({
    narrationId: zNarrationId,
    chunk: zChunk,
    text: z.string(),
    status: zNarrationStatus,
  }),
);

/**
 * Emitted only once `narration.gm_message` is committed, so a client may treat
 * it as the point of truth (02-mj-ia.md section 6.4). `text`, `model` and
 * `source` are the journal payload's own nodes rather than copies of them: the
 * frame that announces an event cannot describe it differently from the event.
 */
export const zS2CNarrationDone = s2cFrame(
  's2c.narration_done',
  z.strictObject({
    narrationId: zNarrationId,
    eventSeq: zSeq,
    text: zNarrationGmMessagePayload.shape.text,
    model: zNarrationGmMessagePayload.shape.model,
    source: zNarrationSource,
  }),
);

export const zS2CNarrationError = s2cFrame(
  's2c.narration_error',
  z.strictObject({ narrationId: zNarrationId, code: zNarrationErrorCode }),
);

// ----------------------------------------------------------------- the proof

/**
 * Answer to `c2s.why`. A PROJECTION of the journal on one `correlationId`,
 * built on demand by a pure function, per spectator like `zTableState`.
 *
 * `zTurnProof` is reused from `dto/`, never redeclared — M0-05 owns its shape
 * and its bounds (32 effects, 120 characters per label, 8 KiB serialised). Past
 * the ceiling the server sets `truncated: true` and the client falls back to
 * `GET /api/campaigns/:id/log`; it never trims the proof itself.
 */
export const zS2CTurnProof = s2cFrame(
  's2c.turn_proof',
  z.strictObject({
    correlationId: zCorrelationId,
    proof: zTurnProof,
    truncated: z.boolean(),
  }),
);

// ------------------------------------------------------- refusals and errors

/**
 * The rules said no, or the request could not be served. `intentId` is the
 * `id` of the c2s frame being answered — the idempotence key, so the client
 * can match the refusal to what it asked.
 */
export const zS2CRejected = s2cFrame(
  's2c.rejected',
  z.strictObject({
    intentId: zMessageId,
    code: zRejectionCode,
    message: z.string().min(1),
  }),
);

/** `zAppErrorPayload` reused verbatim: one error shape for WS and HTTP. */
export const zS2CError = s2cFrame('s2c.error', zAppErrorPayload);

// ------------------------------------------------------------- housekeeping

export const zS2CPresence = s2cFrame(
  's2c.presence',
  z.strictObject({
    members: z.array(
      z.strictObject({
        playerId: zPlayerId,
        characterId: zCharacterId.nullable(),
        online: z.boolean(),
        typing: z.boolean(),
      }),
    ),
  }),
);

/** The heartbeat. Answered by `c2s.pong`; no `pong` in 60 s closes the socket. */
export const zS2CPing = s2cFrame('s2c.ping', z.strictObject({}));

/** The client must redo `c2s.hello`. `reason` is for the log, not for a player. */
export const zS2CResyncRequired = s2cFrame(
  's2c.resync_required',
  z.strictObject({ reason: z.string().min(1).max(120) }),
);

export const zS2CMessage = z.discriminatedUnion('t', [
  zS2CWelcome,
  zS2CSnapshot,
  zS2CEvent,
  zS2CEventsBatch,
  zS2CNarrationStarted,
  zS2CNarrationDelta,
  zS2CNarrationSnapshot,
  zS2CNarrationDone,
  zS2CNarrationError,
  zS2CTurnProof,
  zS2CRejected,
  zS2CError,
  zS2CPresence,
  zS2CPing,
  zS2CResyncRequired,
]);

/** The same schema under the name section 2.4 uses. One parse path, two names. */
export const zS2CEnvelope = zS2CMessage;

export type S2CMessage = z.output<typeof zS2CMessage>;
export type S2CMessageType = S2CMessage['t'];

/** Derived, never hand-written. */
export function s2cMessageTypesOfSchema(): readonly string[] {
  return zS2CMessage.options.map((option) => option.shape.t.value);
}

/**
 * Whether a serialised proof fits under the ceiling M0-05 declares. The server
 * calls this to decide `truncated`; it is here rather than in `dto/` because
 * the ceiling exists to protect the FRAME, which is a protocol concern.
 */
export function fitsOutgoingFrame(serialisedBytes: number): boolean {
  return serialisedBytes <= WS_MAX_OUTGOING_FRAME_BYTES;
}
