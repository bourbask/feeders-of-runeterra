/**
 * The structured memory: who, what and where of a campaign.
 *
 * This is the half of invariant 2 that is queryable. The other half, the
 * chronicle, is text. Neither lives in the context window.
 */

import type { EntityId } from '../ids.js';

export const ENTITY_KINDS = [
  'npc',
  'place',
  'faction',
  'item',
  'beast',
  'thread',
  'presage',
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_STATUSES = ['active', 'dormant', 'dead', 'destroyed', 'resolved'] as const;

export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const ENTITY_DISPOSITIONS = ['allie', 'neutre', 'hostile', 'inconnu'] as const;

export type EntityDisposition = (typeof ENTITY_DISPOSITIONS)[number];

export interface EntityState {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly slug: string;
  readonly name: string;
  /** One or two sentences, injected into the prompt. Content text. */
  readonly summary: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly championId: string | null;
  readonly regionId: string | null;
  readonly status: EntityStatus;
  readonly disposition: EntityDisposition | null;
  readonly firstSeenSeq: number;
  readonly lastSeenSeq: number;
}
