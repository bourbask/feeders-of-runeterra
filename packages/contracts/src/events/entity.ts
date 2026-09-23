/** `entity.*` payloads — the structured half of invariant 2. */

import { z } from 'zod';

import type {
  EntityIntroducedPayload,
  EntityMentionedPayload,
  EntityStatusChangedPayload,
  EntityUpdatedPayload,
} from '@for/engine';

import { zEntityDisposition, zEntityKind, zEntityStatus } from '../core/enums.js';
import { zEntityId, zEventCause, zJsonObject, zSlug } from '../primitives.js';

export const zEntityIntroducedPayload = z.object({
  entityId: zEntityId,
  kind: zEntityKind,
  slug: zSlug,
  name: z.string().min(1),
  /** One or two sentences, injected into the prompt. */
  summary: z.string(),
  regionId: zSlug.optional(),
  championId: zSlug.optional(),
  disposition: zEntityDisposition.optional(),
  details: zJsonObject,
}) satisfies z.ZodType<EntityIntroducedPayload>;

export const zEntityUpdatedPayload = z.object({
  patch: zJsonObject,
  before: zJsonObject,
  entityId: zEntityId,
}) satisfies z.ZodType<EntityUpdatedPayload>;

export const zEntityStatusChangedPayload = z.object({
  entityId: zEntityId,
  from: zEntityStatus,
  to: zEntityStatus,
  cause: zEventCause,
}) satisfies z.ZodType<EntityStatusChangedPayload>;

/** Lightweight: refreshes `last_seen_seq`. */
export const zEntityMentionedPayload = z.object({
  entityId: zEntityId,
}) satisfies z.ZodType<EntityMentionedPayload>;
