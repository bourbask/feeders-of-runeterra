/**
 * The structured memory: who, what and where of a campaign.
 *
 * This is the half of invariant 2 that is queryable. The other half, the
 * chronicle, is text. Neither lives in the context window.
 */

import { z } from 'zod';

import type { EntityState } from '@for/engine';

import { zEntityId, zJsonObject, zSeq, zSlug } from '../primitives.js';
import { zEntityDisposition, zEntityKind, zEntityStatus } from './enums.js';

export const zEntityState = z.object({
  id: zEntityId,
  kind: zEntityKind,
  slug: zSlug,
  name: z.string(),
  /** One or two sentences, injected into the prompt. Content text. */
  summary: z.string(),
  details: zJsonObject,
  championId: zSlug.nullable(),
  regionId: zSlug.nullable(),
  status: zEntityStatus,
  disposition: zEntityDisposition.nullable(),
  firstSeenSeq: zSeq,
  lastSeenSeq: zSeq,
}) satisfies z.ZodType<EntityState>;

export type EntityStateDto = z.output<typeof zEntityState>;
