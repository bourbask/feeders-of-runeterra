/**
 * The event envelope every one of the 71 variants inherits
 * (03-donnees.md section 3.1).
 *
 * The shape is exported, not the schema alone, because each variant is built
 * by SPREADING it rather than by `.extend()`. Same result, far less type
 * instantiation for the compiler across 71 objects — and 71 is not a number
 * where that stops mattering.
 *
 * TWO DIVERGENCES FROM THE MARKDOWN OF SECTION 3.1, both forced by the mirror
 * rule, both reported rather than papered over:
 *
 *   - `rngStream` is `z.string().nullable()` in the spec and the closed
 *     `RngStream` union in the engine. The engine is canonical, so this is
 *     `zRngStream.nullable()`; a free string would fail
 *     `satisfies z.ZodType<GameEvent>`.
 *   - the identifiers are branded (`zEventId`, `zCampaignId`, …) rather than a
 *     shared `UlidSchema`, because the engine brands them and a bare `string`
 *     is not assignable to `EventId`.
 */

import { z } from 'zod';

import type { EventEnvelope } from '@for/engine';

import { zActorKind, zRngStream } from '../core/enums.js';
import {
  zCampaignId,
  zCharacterId,
  zCorrelationId,
  zEpochMillis,
  zEventId,
  zPlayerId,
  zPlaySessionId,
  zSeq,
} from '../primitives.js';

export const eventEnvelopeShape = {
  id: zEventId,
  campaignId: zCampaignId,
  /** Dense, strictly increasing within a campaign, starting at 1. */
  seq: zSeq,
  playSessionId: zPlaySessionId.nullable(),
  payloadVersion: z.number().int().positive().default(1),
  actorKind: zActorKind,
  actorPlayerId: zPlayerId.nullable(),
  subjectCharacterId: zCharacterId.nullable(),
  /** Groups every event of one turn. `zTurnProof` keys on it. */
  correlationId: zCorrelationId.nullable(),
  causationId: zEventId.nullable(),
  rngStream: zRngStream.nullable(),
  rngDrawIndex: z.number().int().nonnegative().nullable(),
  createdAt: zEpochMillis,
};

export const zEventEnvelope = z.object(eventEnvelopeShape) satisfies z.ZodType<EventEnvelope>;

export type EventEnvelopeDto = z.output<typeof zEventEnvelope>;
