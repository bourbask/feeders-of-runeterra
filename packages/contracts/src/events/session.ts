/** `session.*`, `chronicle.*` and `system.*` payloads. */

import { z } from 'zod';

import type {
  ChronicleCompactedPayload,
  SessionClosedPayload,
  SessionOpenedPayload,
  SystemCorrectionPayload,
  SystemNotePayload,
  SystemPayloadUpcastPayload,
  SystemRevertedPayload,
  SystemRulesVersionMigratedPayload,
} from '@for/engine';

import { zAiCallId, zChronicleId, zPlayerId, zPlaySessionId, zSeq } from '../primitives.js';

export const zSessionOpenedPayload = z.object({
  playSessionId: zPlaySessionId,
  ordinal: z.number().int().positive(),
  title: z.string().optional(),
  presentPlayerIds: z.array(zPlayerId),
}) satisfies z.ZodType<SessionOpenedPayload>;

export const zSessionClosedPayload = z.object({
  playSessionId: zPlaySessionId,
  firstSeq: zSeq,
  lastSeq: zSeq,
  recapChronicleId: zChronicleId.optional(),
}) satisfies z.ZodType<SessionClosedPayload>;

export const zChronicleCompactedPayload = z.object({
  chronicleId: zChronicleId,
  version: z.number().int().positive(),
  kind: z.enum(['incremental', 'rebuild']),
  sourceEventSeq: zSeq,
  aiCallId: zAiCallId,
  tokenCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<ChronicleCompactedPayload>;

/**
 * Cancellation (03-donnees.md section 3.7). The journal is append-only, so a
 * turn is never deleted: this line MARKS it. `byPlayerId` is `null` when the
 * emitter is not human — the storyteller's right of refusal, which carries
 * `actorKind: 'system'` and `reason: 'gm_refusal:<cause>'`.
 *
 * `targetSeqs` is always the whole `correlation_id` group. Reverting a
 * `roll.action_resolved` without the `character.gauge_changed` it caused would
 * leave an incoherent state.
 */
export const zSystemRevertedPayload = z.object({
  targetSeqs: z.array(zSeq).min(1),
  reason: z.string().min(1),
  byPlayerId: zPlayerId.nullable(),
}) satisfies z.ZodType<SystemRevertedPayload>;

/** A traced manual fix, typically a typo in a name. */
export const zSystemCorrectionPayload = z.object({
  targetSeq: zSeq,
  field: z.string(),
  from: z.unknown(),
  to: z.unknown(),
  reason: z.string(),
}) satisfies z.ZodType<SystemCorrectionPayload>;

export const zSystemRulesVersionMigratedPayload = z.object({
  from: z.number().int(),
  to: z.number().int(),
  note: z.string(),
}) satisfies z.ZodType<SystemRulesVersionMigratedPayload>;

export const zSystemPayloadUpcastPayload = z.object({
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive(),
  affectedTypes: z.array(z.string()),
}) satisfies z.ZodType<SystemPayloadUpcastPayload>;

/** A free bookmark in the journal. */
export const zSystemNotePayload = z.object({
  text: z.string(),
  byPlayerId: zPlayerId,
}) satisfies z.ZodType<SystemNotePayload>;
