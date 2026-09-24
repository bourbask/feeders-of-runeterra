/**
 * `move.*` payloads.
 *
 * `move.resolved.effectsApplied` is the ALREADY EXECUTED list; each effect has
 * also produced its own `character.*` or `track.*` event. It is a summary view
 * for the UI and the prompt, never a source of truth — and it carries NO
 * `playerChoices`: no price consequence is chosen by anyone (ADR 0006).
 */

import { z } from 'zod';

import type { MoveAbortedPayload, MoveDeclaredPayload, MoveResolvedPayload } from '@for/engine';

import { zEngineEffect } from '../core/effects.js';
import { zAttributeId, zMoveId, zOutcome } from '../core/enums.js';
import { zCharacterId, zSeq } from '../primitives.js';
import { zRollAdd } from './dice.js';

export const zMoveDeclaredPayload = z.object({
  moveId: zMoveId,
  characterId: zCharacterId,
  /** What the player wrote. Free French text, carried, never interpreted. */
  narrativeInput: z.string(),
  chosenAttribute: zAttributeId.optional(),
  declaredAdds: z.array(zRollAdd).optional(),
}) satisfies z.ZodType<MoveDeclaredPayload>;

export const zMoveResolvedPayload = z.object({
  moveId: zMoveId,
  characterId: zCharacterId,
  rollSeq: zSeq,
  outcome: zOutcome,
  effectsApplied: z.array(zEngineEffect),
}) satisfies z.ZodType<MoveResolvedPayload>;

export const zMoveAbortedPayload = z.object({
  moveId: zMoveId,
  characterId: zCharacterId,
  reason: z.string(),
}) satisfies z.ZodType<MoveAbortedPayload>;
