/**
 * `scene.*` and `narration.*` payloads.
 *
 * `scene.facts_updated` IS THE BOUNDED ONE. It carries a COMPLETE snapshot of
 * the scene, never a delta, because a delta would force the reducer to reason
 * about application order and the reducer must stay total and judgement-free
 * (03-donnees.md section 3.3, rule 2). It is emitted only when the merge
 * actually changes something. Its two lists are capped at eight entries each
 * and its `absent` causes are drawn from `parti | mort | hors_de_portee` —
 * the bounds live once, in `core/scene-state.ts`, and are reused here.
 *
 * `narration.gm_proposal` HAS NO `price_choice` KIND, and will not get one
 * without an ADR. `kind: 'refusal'` carries only `{ cause, target }`: no
 * value, no effect, no sequence number. The server recomputes the proof and
 * the sequences to revert, alone.
 */

import { z } from 'zod';

import type {
  NarrationGmFailedPayload,
  NarrationGmMessagePayload,
  NarrationGmProposalPayload,
  NarrationPlayerMessagePayload,
  NarrationProposalAcceptedPayload,
  NarrationProposalRejectedPayload,
  NarrationSafetyFlagPayload,
  SceneEndedPayload,
  SceneFactsUpdatedPayload,
  SceneStartedPayload,
} from '@for/engine';

import { zGmProposalKind } from '../core/enums.js';
import {
  SCENE_NAME_MAX,
  SCENE_TIME_OF_DAY_MAX,
  zSceneAbsenceList,
  zScenePresenceList,
} from '../core/scene-state.js';
import { zAiCallId, zCharacterId, zProposalId, zSceneId, zSeq, zSlug } from '../primitives.js';

export const zSceneStartedPayload = z.object({
  sceneId: zSceneId,
  title: z.string(),
  regionId: zSlug.optional(),
  entityIds: z.array(z.string()),
  presentCharacterIds: z.array(z.string()),
}) satisfies z.ZodType<SceneStartedPayload>;

export const zSceneEndedPayload = z.object({
  sceneId: zSceneId,
  outcome: z.string().optional(),
}) satisfies z.ZodType<SceneEndedPayload>;

export const zSceneFactsUpdatedPayload = z.object({
  sceneId: zSceneId,
  placeId: z.string().optional(),
  placeName: z.string().max(SCENE_NAME_MAX).optional(),
  timeOfDay: z.string().max(SCENE_TIME_OF_DAY_MAX).optional(),
  /** At most 8. A ninth present entry is refused, not truncated. */
  present: zScenePresenceList,
  /** At most 8, each with a cause from the closed list. */
  absent: zSceneAbsenceList,
  source: z.enum(['gm_ai', 'engine', 'player']),
  aiCallId: zAiCallId.optional(),
}) satisfies z.ZodType<SceneFactsUpdatedPayload>;

export const zNarrationPlayerMessagePayload = z.object({
  text: z.string(),
  kind: z.enum(['ic', 'ooc']),
  characterId: zCharacterId.optional(),
}) satisfies z.ZodType<NarrationPlayerMessagePayload>;

export const zNarrationGmMessagePayload = z.object({
  text: z.string(),
  aiCallId: zAiCallId,
  model: z.string(),
  promptVersion: z.string(),
  source: z.enum(['ai', 'engine']),
  respondsToSeq: zSeq.optional(),
  /** The journal lines the prose leans on. Auditable by construction. */
  citedEventSeqs: z.array(zSeq),
}) satisfies z.ZodType<NarrationGmMessagePayload>;

export const zNarrationGmFailedPayload = z.object({
  aiCallId: zAiCallId.optional(),
  errorKind: z.enum([
    'api_error',
    'refused',
    'invalid_output',
    'rejected_by_postfilter',
    'aborted',
  ]),
  fallbackText: z.string(),
}) satisfies z.ZodType<NarrationGmFailedPayload>;

export const zNarrationGmProposalPayload = z.object({
  proposalId: zProposalId,
  kind: zGmProposalKind,
  /**
   * Deliberately `unknown`: each `kind` has its own schema, and those live in
   * `src/ai/` (M0-18). Typing it here would put the model's proposal shapes in
   * the journal contract, where a future kind could not be added without an
   * upcaster — and 03-donnees.md section 3.4 states the opposite.
   */
  payload: z.unknown(),
}) satisfies z.ZodType<NarrationGmProposalPayload>;

export const zNarrationProposalAcceptedPayload = z.object({
  proposalId: zProposalId,
  resultingEventSeqs: z.array(zSeq),
}) satisfies z.ZodType<NarrationProposalAcceptedPayload>;

/**
 * A first-class event, not a log line: the rejection rate per `reasonCode` is
 * a quality metric of the AI GM, and an imbalance of refusal codes across turn
 * outcomes is exactly the abuse signal of 02-mj-ia.md section 4.8.5.
 */
export const zNarrationProposalRejectedPayload = z.object({
  proposalId: zProposalId,
  reasonCode: z.string().min(1),
  validationErrors: z.array(z.string()),
}) satisfies z.ZodType<NarrationProposalRejectedPayload>;

export const zNarrationSafetyFlagPayload = z.object({
  kind: z.enum(['pause', 'rewind', 'veil']),
  note: z.string().optional(),
}) satisfies z.ZodType<NarrationSafetyFlagPayload>;
